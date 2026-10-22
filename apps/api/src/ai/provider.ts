import { type z } from 'zod';

/** One request for structured output from a model. */
export type AiRequest = {
  model: string;
  system: string;
  prompt: string;
  /** The shape the response should take. The caller still validates it. */
  outputSchema: z.ZodType;
  maxTokens: number;
};

export type AiResponse = {
  /** The response text, expected to be JSON matching the output schema. */
  text: string;
  /** The model that actually answered. */
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/**
 * The small interface every AI call goes through, so domain code never
 * depends on a vendor SDK. Supplied on the tRPC context: production uses
 * Anthropic, tests use the fake in `fakeProvider.ts`.
 */
export interface AiProvider {
  generate(request: AiRequest): Promise<AiResponse>;
}
