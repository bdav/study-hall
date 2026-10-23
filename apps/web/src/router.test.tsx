import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes } from './router';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({})),
    auth: {
      me: {
        useQuery: vi.fn(() => ({
          data: { user: { id: 'u', email: 'me@example.com', canUseAI: true } },
          isLoading: false,
        })),
      },
      logout: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
    },
    aiUsage: {
      summary: { useQuery: vi.fn(() => ({ data: undefined })) },
      report: {
        useQuery: vi.fn(() => ({
          data: {
            month: '2026-10',
            totalUsd: 0,
            breakdown: [],
            previousMonths: [],
          },
          isLoading: false,
        })),
      },
    },
    course: {
      list: { useQuery: vi.fn(() => ({ data: [], isLoading: false })) },
    },
    deck: {
      list: { useQuery: vi.fn(() => ({ data: [], isLoading: false })) },
      create: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
      delete: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
    },
  },
}));

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('routes', () => {
  it('lands on Courses by default', async () => {
    const router = renderAt('/');

    expect(
      await screen.findByRole('heading', { name: 'Your Courses' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/courses');
  });

  it('shows the decks under Flashcards', async () => {
    renderAt('/flashcards');

    expect(
      await screen.findByRole('heading', { name: 'Your Decks' }),
    ).toBeInTheDocument();
  });

  it('shows AI usage at /ai-usage', async () => {
    renderAt('/ai-usage');

    expect(
      await screen.findByRole('heading', { name: 'AI usage' }),
    ).toBeInTheDocument();
  });
});
