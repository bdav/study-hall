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
export type TokenUsage = {
  /** Input tokens neither written to nor read from the prompt cache. */
  inputTokens: number;
  /** Input tokens written to the 5-minute prompt cache. */
  cacheWrite5mTokens?: number;
  /** Input tokens written to the 1-hour prompt cache. */
  cacheWrite1hTokens?: number;
  /** Input tokens read from the prompt cache. */
  cacheReadTokens?: number;
  outputTokens: number;
};

export type AiResponse = TokenUsage & {
  /** The response text, expected to be JSON matching the output schema. */
  text: string;
  /** The model that actually answered. */
  model: string;
};

/** One request for a conversational reply, streamed as it is written. */
export type AiChatRequest = {
  model: string;
  /**
   * The system prompt in blocks, in order. A cached block is cached with
   * everything before it, so stable blocks come first.
   */
  system: { text: string; cache?: boolean }[];
  /** The conversation so far, oldest first, ending with the user's turn. */
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
};

/**
 * What a streamed reply yields: its text in pieces as they arrive, then,
 * once, how it ended.
 */
export type AiChatEvent =
  | { type: 'text'; text: string }
  | ({
      type: 'done';
      /** The model that actually answered. */
      model: string;
      /** The model declined to answer; any text so far is incomplete. */
      refused: boolean;
    } & TokenUsage);

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
  /**
   * Streams a reply. A stream that fails once the model has started
   * answering throws `AiOutcomeUnknownError`, since it may be billed.
   */
  streamChat(request: AiChatRequest): AsyncIterable<AiChatEvent>;
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
