import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  AiOutcomeUnknownError,
  type AiProvider,
  type TokenUsage,
} from './provider.js';

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
        ...tokenUsage(response.usage),
      };
    },

    async *streamChat(request) {
      client ??= new Anthropic({ maxRetries: 0 });
      // Known once the model starts answering, from when the call is billed
      let started: TokenUsage | undefined;
      try {
        const stream = client.beta.messages.stream({
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system.map(({ text, cache }) => ({
            type: 'text' as const,
            text,
            ...(cache && { cache_control: { type: 'ephemeral' as const } }),
          })),
          messages: request.messages,
          // Also caches the conversation so far, for the next message
          cache_control: { type: 'ephemeral' },
          // Conversation needs little thinking, and replies start sooner
          output_config: { effort: 'low' },
          // Retry on the server-defined fallback model if this one declines
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });

        for await (const event of stream) {
          if (event.type === 'message_start') {
            started = tokenUsage(event.message.usage);
          } else if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            yield { type: 'text', text: event.delta.text };
          }
        }

        const message = await stream.finalMessage();
        yield {
          type: 'done',
          model: message.model,
          refused: message.stop_reason === 'refusal',
          ...tokenUsage(message.usage),
        };
      } catch (error) {
        // A stream that fails once the model has started answering may be
        // billed, as may a call that never got a response
        if (
          started !== undefined ||
          error instanceof Anthropic.APIConnectionError
        ) {
          throw new AiOutcomeUnknownError(
            error instanceof Error ? error.message : String(error),
            {
              cause: error,
              // Its output so far is unknown, so it's taken as the most
              usage: started && {
                ...started,
                outputTokens: request.maxTokens,
              },
            },
          );
        }
        throw error;
      }
    },
  };
}

/**
 * A call's tokens as the API reports them. Cache writes it doesn't
 * attribute to a lifetime count as 1-hour writes, the dearer, so the cap
 * never undercounts.
 */
function tokenUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  } | null;
}): TokenUsage {
  const byLifetime = usage.cache_creation;
  return {
    inputTokens: usage.input_tokens,
    cacheWrite5mTokens: byLifetime?.ephemeral_5m_input_tokens ?? 0,
    cacheWrite1hTokens:
      byLifetime?.ephemeral_1h_input_tokens ??
      usage.cache_creation_input_tokens ??
      0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens,
  };
}
