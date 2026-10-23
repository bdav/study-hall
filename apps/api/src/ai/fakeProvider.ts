import {
  AiOutcomeUnknownError,
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
    };

/**
 * A provider for tests: it answers with queued fixtures, in order, and
 * records every request it receives. It never makes a network call.
 */
export function createFakeAiProvider() {
  const queue: FakeResponse[] = [];
  const requests: AiRequest[] = [];

  const provider: AiProvider & {
    requests: AiRequest[];
    respondWith: (output: unknown, usage?: TokenUsage) => void;
    failWith: (failure: FakeFailure, usage?: TokenUsage) => void;
    reset: () => void;
  } = {
    requests,

    /** Queues a response. A string is returned as raw text, anything else as JSON. */
    respondWith(output, usage = { inputTokens: 100, outputTokens: 200 }) {
      queue.push({ output, ...usage });
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
    },

    async generate(request) {
      requests.push(request);
      const next = queue.shift();
      if (!next) throw new Error('The fake AI provider has no response queued');
      if ('failure' in next) throw fakeError(next.failure, next.usage);

      return {
        text:
          typeof next.output === 'string'
            ? next.output
            : JSON.stringify(next.output),
        model: request.model,
        inputTokens: next.inputTokens,
        outputTokens: next.outputTokens,
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
