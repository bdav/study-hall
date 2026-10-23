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
