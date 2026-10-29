import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, httpBatchStreamLink, splitLink } from '@trpc/client';
import { useState, type PropsWithChildren } from 'react';
import { trpc } from './lib/trpc';
import { TooltipProvider } from '@/components/ui/tooltip';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/trpc';

/** Sends the session cookie to the API, which is on another origin. */
const withCredentials: typeof fetch = (url, options) =>
  fetch(url, { ...options, credentials: 'include' });

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        // The tutor's reply streams in as it's written. Only it streams:
        // a streamed response's headers go out before its procedures run,
        // so procedures that set cookies, such as logging in, can't
        splitLink({
          condition: (op) => op.path === 'tutor.ask',
          true: httpBatchStreamLink({ url: API_URL, fetch: withCredentials }),
          false: httpBatchLink({ url: API_URL, fetch: withCredentials }),
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
