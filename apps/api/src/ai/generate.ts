import { type AiPurpose, type PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  type AiChatEvent,
  type AiChatRequest,
  AiOutcomeUnknownError,
  type AiProvider,
  type AiRequest,
  type TokenUsage,
} from './provider.js';
import { type PricedModel } from './spend.js';

/**
 * Runs one structured AI operation and writes its AI usage record. Returns
 * the validated output with the model and prompt version that produced it,
 * for the caller to store.
 *
 * A failed call or output that fails the schema throws a retryable
 * BAD_GATEWAY error before the caller can store anything. A call that ended
 * without a response may still have been billed, so it is recorded as
 * failed, with a conservative estimate when the provider has no counts.
 */
export async function generateStructured<Schema extends z.ZodType>(
  { prisma, ai }: { prisma: PrismaClient; ai: AiProvider },
  request: {
    userId: string;
    purpose: AiPurpose;
    model: PricedModel;
    promptVersion: string;
    system: string;
    prompt: string;
    outputSchema: Schema;
    maxTokens?: number;
  },
) {
  const providerRequest: AiRequest = {
    model: request.model,
    system: request.system,
    prompt: request.prompt,
    outputSchema: request.outputSchema,
    maxTokens: request.maxTokens ?? 16000,
  };

  let response;
  try {
    response = await ai.generate(providerRequest);
  } catch (cause) {
    // The API may have billed a call that ended without a response
    if (cause instanceof AiOutcomeUnknownError) {
      await prisma.aiUsage.create({
        data: {
          userId: request.userId,
          purpose: request.purpose,
          model: request.model,
          ...usageCounts(
            cause.usage ?? {
              inputTokens: estimateInputTokens(providerRequest),
              outputTokens: providerRequest.maxTokens,
            },
          ),
          failed: true,
        },
      });
    }
    throw retryableError(cause);
  }

  await prisma.aiUsage.create({
    data: {
      userId: request.userId,
      purpose: request.purpose,
      model: response.model,
      ...usageCounts(response),
    },
  });

  const parsed = request.outputSchema.safeParse(parseJson(response.text));
  if (!parsed.success) throw retryableError(parsed.error);

  return {
    output: parsed.data as z.infer<Schema>,
    model: response.model,
    promptVersion: request.promptVersion,
  };
}

/**
 * Runs one streamed conversational reply and writes its AI usage record,
 * yielding the reply's text in pieces as they arrive. Once the reply is
 * complete, `onComplete` stores it.
 *
 * The call runs to the end even if the caller stops reading, such as when
 * the learner leaves the page, so the reply is still stored and its usage
 * recorded. A failed call or a refusal throws a retryable BAD_GATEWAY error
 * from the stream, and nothing is stored. As with `generateStructured`, a
 * call that ended without a response is recorded as failed.
 */
export function generateStreamed(
  { prisma, ai }: { prisma: PrismaClient; ai: AiProvider },
  request: {
    userId: string;
    purpose: AiPurpose;
    chat: AiChatRequest & { model: PricedModel };
    onComplete: (reply: { text: string; model: string }) => Promise<void>;
  },
): AsyncGenerator<string> {
  const pieces: string[] = [];
  let finished = false;
  let failure: unknown;
  let wake = () => {};

  const run = async () => {
    let text = '';
    let ending: Extract<AiChatEvent, { type: 'done' }> | undefined;
    try {
      for await (const event of ai.streamChat(request.chat)) {
        if (event.type === 'text') {
          text += event.text;
          pieces.push(event.text);
          wake();
        } else {
          ending = event;
        }
      }
    } catch (cause) {
      // The API may have billed a call that ended without a response
      if (cause instanceof AiOutcomeUnknownError) {
        await prisma.aiUsage.create({
          data: {
            userId: request.userId,
            purpose: request.purpose,
            model: request.chat.model,
            ...usageCounts(
              cause.usage ?? {
                inputTokens: estimateChatTokens(request.chat),
                outputTokens: request.chat.maxTokens,
              },
            ),
            failed: true,
          },
        });
      }
      throw retryableError(cause);
    }
    if (!ending) throw retryableError(new Error('The reply never finished'));

    await prisma.aiUsage.create({
      data: {
        userId: request.userId,
        purpose: request.purpose,
        model: ending.model,
        ...usageCounts(ending),
      },
    });
    // A refusal's text so far is incomplete, so it isn't kept
    if (ending.refused || !text.trim()) {
      throw retryableError(new Error('No usable reply'));
    }
    await request.onComplete({ text: text.trim(), model: ending.model });
  };

  // Not awaited: it outlives a caller that stops reading. Its failure,
  // retryable when the AI's and otherwise as it was, ends the stream
  void run()
    .catch((cause: unknown) => {
      failure = cause;
    })
    .finally(() => {
      finished = true;
      wake();
    });

  return (async function* () {
    while (true) {
      const piece = pieces.shift();
      if (piece !== undefined) {
        yield piece;
      } else if (finished) {
        break;
      } else {
        await new Promise<void>((resolve) => (wake = resolve));
      }
    }
    if (failure) throw failure;
  })();
}

/** A call's token counts as its AI usage record stores them. */
function usageCounts(usage: TokenUsage) {
  return {
    inputTokens: usage.inputTokens,
    cacheWrite5mTokens: usage.cacheWrite5mTokens ?? 0,
    cacheWrite1hTokens: usage.cacheWrite1hTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    outputTokens: usage.outputTokens,
  };
}

/**
 * A generous estimate of a request's input tokens, for a failed call whose
 * provider reported none: the bytes of the prompts and output schema. A
 * token usually spans several bytes of text, so this overcounts the text we
 * send, but it can't see tokens the API adds on its own, such as for
 * structured output, so it isn't a guaranteed upper bound.
 */
function estimateInputTokens(request: AiRequest): number {
  const schema = JSON.stringify(
    // An estimate on the error path must not throw
    z.toJSONSchema(request.outputSchema, { unrepresentable: 'any' }),
  );
  return Buffer.byteLength(request.system + request.prompt + schema, 'utf8');
}

/** As `estimateInputTokens`, for a conversational request. */
function estimateChatTokens(request: AiChatRequest): number {
  const text = [...request.system, ...request.messages]
    .map((block) => ('text' in block ? block.text : block.content))
    .join('');
  return Buffer.byteLength(text, 'utf8');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function retryableError(cause: unknown) {
  return new TRPCError({
    code: 'BAD_GATEWAY',
    message: "The AI didn't produce a usable answer. Please try again.",
    cause,
  });
}
