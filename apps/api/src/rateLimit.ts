/**
 * Counts attempts per key in fixed windows, each starting at a key's first
 * attempt, and says whether another is allowed. Counts are held in memory,
 * for the one API process, so they reset when it restarts.
 */
export function createRateLimiter({
  limit,
  windowMs,
}: {
  limit: number;
  windowMs: number;
}) {
  const windows = new Map<string, { count: number; endsAt: number }>();
  let nextSweepAt = 0;

  return function allow(key: string): boolean {
    const now = Date.now();

    // Forget finished windows now and then, so the map can't grow for ever
    if (now >= nextSweepAt) {
      nextSweepAt = now + windowMs;
      for (const [windowKey, window] of windows) {
        if (now >= window.endsAt) windows.delete(windowKey);
      }
    }

    const window = windows.get(key);
    if (!window || now >= window.endsAt) {
      windows.set(key, { count: 1, endsAt: now + windowMs });
      return true;
    }

    window.count += 1;
    return window.count <= limit;
  };
}

export type ClientRequest = {
  ip?: string;
  get(header: string): string | undefined;
};

/**
 * The client's address. In production that's `X-Real-IP`, which Railway's
 * proxy documents as the client's remote IP. `X-Forwarded-For` isn't
 * documented, and a client can write to it. Elsewhere nothing sets a
 * forwarding header but the client, so it's the connection's address.
 */
export function clientIpOf(req: ClientRequest): string {
  const proxied =
    process.env.NODE_ENV === 'production' ? req.get('x-real-ip') : undefined;
  return proxied || req.ip || 'unknown';
}
