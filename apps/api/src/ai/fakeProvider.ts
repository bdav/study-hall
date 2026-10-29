import {
  AiOutcomeUnknownError,
  type AiChatRequest,
  type AiProvider,
  type AiRequest,
  type TokenUsage,
} from './provider.js';

/**
 * How a fake call can fail: a timeout or dropped connection leaves the
 * outcome unknown, so the call may have been billed; an API error response
 * was not billed.
 */
export type FakeFailure = 'timeout' | 'connection-error' | 'api-error';

type FakeResponse =
  | ({ output: unknown } & TokenUsage)
  | {
      failure: FakeFailure;
      usage?: TokenUsage;
    }
  | {
      chunks: string[];
      usage: TokenUsage;
      refused: boolean;
      failAfter?: FakeFailure;
      holdUntil?: Promise<void>;
    };

const DEFAULT_USAGE: TokenUsage = { inputTokens: 100, outputTokens: 200 };

/**
 * A provider for tests: it answers with queued fixtures, in order, and
 * records every request it receives. It never makes a network call.
 */
export function createFakeAiProvider() {
  const queue: FakeResponse[] = [];
  const requests: AiRequest[] = [];
  const chatRequests: AiChatRequest[] = [];

  const provider: AiProvider & {
    requests: AiRequest[];
    chatRequests: AiChatRequest[];
    respondWith: (output: unknown, usage?: TokenUsage) => void;
    streamReply: (
      chunks: string[],
      options?: {
        usage?: TokenUsage;
        refused?: boolean;
        failAfter?: FakeFailure;
        holdUntil?: Promise<void>;
      },
    ) => void;
    failWith: (failure: FakeFailure, usage?: TokenUsage) => void;
    reset: () => void;
  } = {
    requests,
    chatRequests,

    /** Queues a response. A string is returned as raw text, anything else as JSON. */
    respondWith(output, usage = DEFAULT_USAGE) {
      queue.push({ output, ...usage });
    },

    /**
     * Queues a streamed reply, yielded in the pieces given. It can end in a
     * refusal, or fail after its pieces, carrying the usage given, and be
     * held open after its pieces until `holdUntil` settles.
     */
    streamReply(
      chunks,
      { usage = DEFAULT_USAGE, refused = false, failAfter, holdUntil } = {},
    ) {
      queue.push({ chunks, usage, refused, failAfter, holdUntil });
    },

    /**
     * Queues a failed call. A timeout or connection error can carry the
     * token counts the provider knew when it failed.
     */
    failWith(failure, usage) {
      queue.push({ failure, usage });
    },

    reset() {
      queue.length = 0;
      requests.length = 0;
      chatRequests.length = 0;
    },

    async generate(request) {
      requests.push(request);
      const next = queue.shift();
      if (!next) throw new Error('The fake AI provider has no response queued');
      if ('failure' in next) throw fakeError(next.failure, next.usage);
      if ('chunks' in next) {
        throw new Error('The fake AI provider has a streamed reply queued');
      }

      return {
        text:
          typeof next.output === 'string'
            ? next.output
            : JSON.stringify(next.output),
        model: request.model,
        inputTokens: next.inputTokens,
        cacheWrite5mTokens: next.cacheWrite5mTokens,
        cacheWrite1hTokens: next.cacheWrite1hTokens,
        cacheReadTokens: next.cacheReadTokens,
        outputTokens: next.outputTokens,
      };
    },

    async *streamChat(request) {
      chatRequests.push(request);
      const next = queue.shift();
      if (!next) throw new Error('The fake AI provider has no response queued');
      if ('failure' in next) throw fakeError(next.failure, next.usage);
      if (!('chunks' in next)) {
        throw new Error(
          'The fake AI provider has a structured response queued',
        );
      }

      for (const text of next.chunks) {
        // Each piece arrives on its own, as from the network
        await Promise.resolve();
        yield { type: 'text', text };
      }
      await next.holdUntil;
      if (next.failAfter) throw fakeError(next.failAfter, next.usage);
      yield {
        type: 'done',
        model: request.model,
        refused: next.refused,
        ...next.usage,
      };
    },
  };

  return provider;
}

function fakeError(failure: FakeFailure, usage?: TokenUsage): Error {
  switch (failure) {
    case 'timeout':
      return new AiOutcomeUnknownError('Request timed out', { usage });
    case 'connection-error':
      return new AiOutcomeUnknownError('Connection error', { usage });
    case 'api-error':
      return new Error('529 Overloaded');
  }
}

export type FakeAiProvider = ReturnType<typeof createFakeAiProvider>;
