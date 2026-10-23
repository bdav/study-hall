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

/** The tokens one call used, as the API bills them. */
export type TokenUsage = { inputTokens: number; outputTokens: number };

export type AiResponse = TokenUsage & {
  /** The response text, expected to be JSON matching the output schema. */
  text: string;
  /** The model that actually answered. */
  model: string;
};

/**
 * The small interface every AI call goes through, so domain code never
 * depends on a vendor SDK. Supplied on the tRPC context: production uses
 * Anthropic, tests use the fake in `fakeProvider.ts`.
 *
 * A call that fails without a response, such as a timeout or a dropped
 * connection, throws `AiOutcomeUnknownError`. Any other failure, such as an
 * error response from the API, was not billed.
 */
export interface AiProvider {
  generate(request: AiRequest): Promise<AiResponse>;
}

/**
 * A call that failed before its response arrived. The API may still have
 * run and billed it, so it counts toward the spending cap.
 */
export class AiOutcomeUnknownError extends Error {
  /** Token counts, when the provider knows them despite the failure. */
  readonly usage?: TokenUsage;

  constructor(
    message: string,
    options: { cause?: unknown; usage?: TokenUsage } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AiOutcomeUnknownError';
    this.usage = options.usage;
  }
}
