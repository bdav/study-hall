import { type AiPurpose, type PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  AiOutcomeUnknownError,
  type AiProvider,
  type AiRequest,
} from './provider.js';

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
    model: string;
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
          inputTokens:
            cause.usage?.inputTokens ?? estimateInputTokens(providerRequest),
          outputTokens: cause.usage?.outputTokens ?? providerRequest.maxTokens,
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
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
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
