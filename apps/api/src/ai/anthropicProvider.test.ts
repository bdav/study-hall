import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { z } from 'zod';
import { createAnthropicProvider } from './anthropicProvider.js';
import { AiOutcomeUnknownError } from './provider.js';

const request = {
  model: 'claude-sonnet-5-5',
  system: 'You design syllabi.',
  prompt: 'Propose a syllabus.',
  outputSchema: z.object({ title: z.string() }),
  maxTokens: 100,
};

/**
 * A local stand-in for the Anthropic API that counts the requests it
 * receives, so tests see every attempt the SDK makes. It never leaves the
 * machine.
 */
let server: http.Server;
let attempts: number;
let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;

beforeEach(async () => {
  attempts = 0;
  server = http.createServer((req, res) => {
    attempts++;
    respond(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  vi.stubEnv('ANTHROPIC_BASE_URL', `http://127.0.0.1:${port}`);
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe('createAnthropicProvider', () => {
  // Each attempt may be billed, so one call must be one attempt for its
  // usage record to account for it
  it('makes one attempt when the connection drops, and reports the outcome as unknown', async () => {
    respond = (req) => req.socket.destroy();

    await expect(createAnthropicProvider().generate(request)).rejects.toThrow(
      AiOutcomeUnknownError,
    );
    expect(attempts).toBe(1);
  });

  it('makes one attempt when the API is overloaded, and reports an ordinary error', async () => {
    respond = (_, res) => {
      res.writeHead(529, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'overloaded_error', message: 'Overloaded' },
        }),
      );
    };

    const failure = await createAnthropicProvider()
      .generate(request)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AiOutcomeUnknownError);
    expect(attempts).toBe(1);
  });
});

const chatRequest = {
  model: 'claude-sonnet-5-5',
  system: [{ text: 'You tutor.' }, { text: 'The lesson.', cache: true }],
  messages: [{ role: 'user' as const, content: 'What does ciao mean?' }],
  maxTokens: 100,
};

/** Server-sent events as the Messages API streams them. */
function sse(events: object[]) {
  return events
    .map((event) => {
      const { type } = event as { type: string };
      return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
    })
    .join('');
}

async function collect(events: AsyncIterable<unknown>) {
  const collected = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe('createAnthropicProvider streamChat', () => {
  it('yields the text as it streams, then the model and every input token', async () => {
    let body: Record<string, unknown> = {};
    respond = (req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        body = JSON.parse(raw) as Record<string, unknown>;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(
          sse([
            {
              type: 'message_start',
              message: {
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                model: 'claude-sonnet-5-5',
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: {
                  input_tokens: 10,
                  cache_creation_input_tokens: 1000,
                  cache_read_input_tokens: 500,
                  output_tokens: 1,
                },
              },
            },
            {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'What do ' },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'you think?' },
            },
            { type: 'content_block_stop', index: 0 },
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 7 },
            },
            { type: 'message_stop' },
          ]),
        );
      });
    };

    const events = await collect(
      createAnthropicProvider().streamChat(chatRequest),
    );

    expect(events).toEqual([
      { type: 'text', text: 'What do ' },
      { type: 'text', text: 'you think?' },
      {
        type: 'done',
        model: 'claude-sonnet-5-5',
        refused: false,
        // Cache writes and reads count as input until they're priced (#31)
        inputTokens: 1510,
        outputTokens: 7,
      },
    ]);
    // The lesson block is cached, and the rules before it aren't marked
    expect(body.system).toEqual([
      { type: 'text', text: 'You tutor.' },
      {
        type: 'text',
        text: 'The lesson.',
        cache_control: { type: 'ephemeral' },
      },
    ]);
    expect(attempts).toBe(1);
  });

  it('makes one attempt when the connection drops, and reports the outcome as unknown', async () => {
    respond = (req) => req.socket.destroy();

    await expect(
      collect(createAnthropicProvider().streamChat(chatRequest)),
    ).rejects.toThrow(AiOutcomeUnknownError);
    expect(attempts).toBe(1);
  });
});
