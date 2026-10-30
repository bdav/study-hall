import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ArchivedDeckNotice } from './ArchivedDeckNotice';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      deck: {
        getById: { invalidate: vi.fn() },
        list: { invalidate: vi.fn() },
        listArchived: { invalidate: vi.fn() },
      },
    })),
    deck: { restore: { useMutation: vi.fn() } },
  },
}));

type RestoreMutation = ReturnType<typeof trpc.deck.restore.useMutation>;
const mockRestore = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(trpc.deck.restore.useMutation).mockReturnValue({
    mutate: mockRestore,
    isPending: false,
  } as unknown as RestoreMutation);
});

describe('ArchivedDeckNotice', () => {
  it("says the deck is archived, what's kept, and that it's read only", () => {
    render(<ArchivedDeckNotice deckId="deck-1" archivedAt="2026-10-01" />);

    expect(screen.getByText(/this deck is archived/i)).toBeInTheDocument();
    expect(
      screen.getByText(/its cards and their history are kept/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/restore it to study/i)).toBeInTheDocument();
  });

  it('restores the deck, without a confirmation', async () => {
    render(<ArchivedDeckNotice deckId="deck-1" archivedAt="2026-10-01" />);

    await userEvent.click(screen.getByRole('button', { name: 'Restore deck' }));

    expect(mockRestore).toHaveBeenCalledWith({ id: 'deck-1' });
  });
});
