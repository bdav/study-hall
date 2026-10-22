import { type AiPurpose, type PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { type z } from 'zod';
import { type AiProvider } from './provider.js';

/**
 * Runs one structured AI operation and writes its AI usage record. Returns
 * the validated output with the model and prompt version that produced it,
 * for the caller to store.
 *
 * A failed call or output that fails the schema throws a retryable
 * BAD_GATEWAY error before the caller can store anything.
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
  let response;
  try {
    response = await ai.generate({
      model: request.model,
      system: request.system,
      prompt: request.prompt,
      outputSchema: request.outputSchema,
      maxTokens: request.maxTokens ?? 16000,
    });
  } catch (cause) {
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
