import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AiOutcomeUnknownError, type AiProvider } from './provider.js';

/**
 * The production provider. The client is created on first use, so the API
 * starts without an Anthropic key and only AI calls need one.
 *
 * The SDK's automatic retries are off: every attempt may be billed, so one
 * call makes one attempt and its usage record accounts for it. A failed
 * call reaches the learner as a retryable error instead.
 */
export function createAnthropicProvider(): AiProvider {
  let client: Anthropic | undefined;

  return {
    async generate(request) {
      client ??= new Anthropic({ maxRetries: 0 });
      let response;
      try {
        response = await client.beta.messages.create({
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
          output_config: { format: zodOutputFormat(request.outputSchema) },
          // Retry on the server-defined fallback model if this one declines
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      } catch (error) {
        // Covers timeouts too. An error response from the API wasn't billed.
        if (error instanceof Anthropic.APIConnectionError) {
          throw new AiOutcomeUnknownError(error.message, { cause: error });
        }
        throw error;
      }

      // A refusal or truncated response leaves text that fails validation
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');

      return {
        text,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}
