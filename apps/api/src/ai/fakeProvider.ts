import { type AiProvider, type AiRequest } from './provider.js';

type FakeResponse =
  | { output: unknown; inputTokens: number; outputTokens: number }
  | { error: Error };

/**
 * A provider for tests: it answers with queued fixtures, in order, and
 * records every request it receives. It never makes a network call.
 */
export function createFakeAiProvider() {
  const queue: FakeResponse[] = [];
  const requests: AiRequest[] = [];

  const provider: AiProvider & {
    requests: AiRequest[];
    respondWith: (
      output: unknown,
      usage?: { inputTokens: number; outputTokens: number },
    ) => void;
    failWith: (error: Error) => void;
    reset: () => void;
  } = {
    requests,

    /** Queues a response. A string is returned as raw text, anything else as JSON. */
    respondWith(output, usage = { inputTokens: 100, outputTokens: 200 }) {
      queue.push({ output, ...usage });
    },

    /** Queues a provider failure, such as a network or API error. */
    failWith(error) {
      queue.push({ error });
    },

    reset() {
      queue.length = 0;
      requests.length = 0;
    },

    async generate(request) {
      requests.push(request);
      const next = queue.shift();
      if (!next) throw new Error('The fake AI provider has no response queued');
      if ('error' in next) throw next.error;

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

export type FakeAiProvider = ReturnType<typeof createFakeAiProvider>;
