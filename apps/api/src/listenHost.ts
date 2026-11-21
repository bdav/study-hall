/**
 * The address the API listens on: `HOST` when set; otherwise every interface
 * in production, where Railway's proxy reaches it, and this machine alone
 * elsewhere, so a dev API can't be reached from the network
 * (`pnpm dev:phone` sets `HOST` to the Mac's Wi-Fi address).
 */
export function listenHost(env: NodeJS.ProcessEnv): string | undefined {
  if (env.HOST) return env.HOST;
  return env.NODE_ENV === 'production' ? undefined : '127.0.0.1';
}
