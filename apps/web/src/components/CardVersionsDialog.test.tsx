import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { toast } from 'sonner';
import { CardVersionsDialog } from './CardVersionsDialog';
import { trpc } from '@/lib/trpc';

const mockInvalidateCards = vi.fn();
const mockInvalidateHistory = vi.fn();

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      card: {
        listByDeck: { invalidate: mockInvalidateCards },
        history: { invalidate: mockInvalidateHistory },
      },
    })),
    card: {
      history: { useQuery: vi.fn() },
      restoreVersion: { useMutation: vi.fn() },
    },
  },
}));

type Version = {
  id: string;
  number: number;
  front: string;
  canonicalAnswers: string[];
  acceptedVariants: string[][] | null;
  sourceModel: string | null;
  restoredFromNumber: number | null;
  startedAt: string;
  endedAt: string | null;
  isCurrent: boolean;
  canRestore: boolean;
  attempts: [];
  answeredCount: number;
  rightCount: number;
};

function version(overrides: Partial<Version> & { number: number }): Version {
  return {
    id: `version-${overrides.number}`,
    front: 'A prime between 10 and 20',
    canonicalAnswers: ['11', '13'],
    acceptedVariants: [[], []],
    sourceModel: null,
    restoredFromNumber: null,
    startedAt: '2026-10-01T12:00:00.000Z',
    endedAt: null,
    isCurrent: false,
    canRestore: true,
    attempts: [],
    answeredCount: 0,
    rightCount: 0,
    ...overrides,
  };
}

/** Three versions: a revision's edit, then version 1 restored. */
const versions = [
  version({
    number: 3,
    isCurrent: true,
    canRestore: false,
    restoredFromNumber: 1,
    acceptedVariants: [['eleven'], []],
    startedAt: '2026-10-25T12:00:00.000Z',
    answeredCount: 1,
    rightCount: 1,
  }),
  version({
    number: 2,
    front: 'A prime in the teens',
    canonicalAnswers: ['17'],
    acceptedVariants: [['seventeen']],
    sourceModel: 'claude-sonnet-5-5',
    startedAt: '2026-10-20T12:00:00.000Z',
    endedAt: '2026-10-25T12:00:00.000Z',
    answeredCount: 3,
    rightCount: 2,
  }),
  version({
    number: 1,
    canRestore: false,
    acceptedVariants: null,
    startedAt: '2026-10-01T12:00:00.000Z',
    endedAt: '2026-10-20T12:00:00.000Z',
    answeredCount: 1,
    rightCount: 0,
  }),
];

const mockRestore = vi.fn();

function mockHistory(
  unversioned: { answeredCount: number; rightCount: number } | null = null,
) {
  vi.mocked(trpc.card.history.useQuery).mockReturnValue({
    data: {
      progress: { lifecycleState: 'NEW', dueAt: null },
      versions,
      unversioned: unversioned && { attempts: [], ...unversioned },
    },
    isError: false,
  } as unknown as ReturnType<typeof trpc.card.history.useQuery>);
}

/** The restore mutation, calling back as the server would. */
function mockRestoreMutation(outcome: 'success' | 'error' = 'success') {
  vi.mocked(trpc.card.restoreVersion.useMutation).mockImplementation(((
    options: {
      onSuccess?: (data: unknown, input: { versionId: string }) => void;
      onError?: (error: { message: string }) => void;
    } = {},
  ) => ({
    mutate: (input: { cardId: string; versionId: string }) => {
      mockRestore(input);
      if (outcome === 'success') options.onSuccess?.({}, input);
      else options.onError?.({ message: 'Version not found' });
    },
    isPending: false,
  })) as unknown as typeof trpc.card.restoreVersion.useMutation);
}

function renderDialog() {
  return render(
    <CardVersionsDialog deckId="deck-1" cardId="card-1" onClose={vi.fn()} />,
  );
}

function versionBlock(name: RegExp | string) {
  return screen.getByRole('group', { name });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHistory();
  mockRestoreMutation();
});

describe('CardVersionsDialog', () => {
  it("lists the card's versions newest first", () => {
    renderDialog();

    const names = screen
      .getAllByRole('group')
      .map((group) => group.getAttribute('aria-label'));
    expect(names).toEqual(['Version 3 (current)', 'Version 2', 'Version 1']);
  });

  it('shows when each version started and ended', () => {
    renderDialog();

    expect(
      within(versionBlock('Version 3 (current)')).getByText('Since Oct 25'),
    ).toBeInTheDocument();
    expect(
      within(versionBlock('Version 2')).getByText('Oct 20 – Oct 25'),
    ).toBeInTheDocument();
  });

  it("shows each version's front and answers, primary first, with their variants", () => {
    renderDialog();

    const current = within(versionBlock('Version 3 (current)'));
    expect(current.getByText('A prime between 10 and 20')).toBeInTheDocument();
    const answers = current
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(answers).toEqual(['11Variants: eleven', '13']);
    expect(
      within(versionBlock('Version 2')).getByText('Variants: seventeen'),
    ).toBeInTheDocument();
  });

  it("says when a version's variants weren't recorded", () => {
    renderDialog();

    expect(
      within(versionBlock('Version 1')).getByText(
        'Variants weren’t recorded for this version.',
      ),
    ).toBeInTheDocument();
    expect(
      within(versionBlock('Version 2')).queryByText(/weren’t recorded/),
    ).not.toBeInTheDocument();
  });

  it('shows how many times each version was answered and how many were right', () => {
    renderDialog();

    expect(
      within(versionBlock('Version 2')).getByText('Answered 3 times · 2 right'),
    ).toBeInTheDocument();
    expect(
      within(versionBlock('Version 1')).getByText('Answered 1 time · 0 right'),
    ).toBeInTheDocument();
  });

  it('says which version a revision of the deck started, and which version a restore restored', () => {
    renderDialog();

    expect(
      within(versionBlock('Version 2')).getByText('From revising the deck'),
    ).toBeInTheDocument();
    expect(
      within(versionBlock('Version 3 (current)')).getByText(
        'Restored version 1',
      ),
    ).toBeInTheDocument();
    expect(
      within(versionBlock('Version 1')).queryByText(/revising|Restored/),
    ).not.toBeInTheDocument();
  });

  it('shows the answers from before versions were recorded as before version 1', () => {
    mockHistory({ answeredCount: 2, rightCount: 1 });

    renderDialog();

    expect(
      within(versionBlock('Before version 1')).getByText(
        'Answered 2 times · 1 right',
      ),
    ).toBeInTheDocument();
  });

  it('offers Restore only on versions that can be restored', () => {
    renderDialog();

    expect(
      within(versionBlock('Version 2')).getByRole('button', {
        name: 'Restore',
      }),
    ).toBeInTheDocument();
    for (const name of ['Version 3 (current)', 'Version 1']) {
      expect(
        within(versionBlock(name)).queryByRole('button', { name: 'Restore' }),
      ).not.toBeInTheDocument();
    }
  });

  it('restores a version after a confirmation that says progress resets and answers are kept', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(
      within(versionBlock('Version 2')).getByRole('button', {
        name: 'Restore',
      }),
    );
    const confirm = screen.getByRole('alertdialog');
    expect(confirm).toHaveTextContent(/progress will reset/i);
    expect(confirm).toHaveTextContent(/answers are kept/i);
    expect(mockRestore).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Restore' }));

    expect(mockRestore).toHaveBeenCalledWith({
      cardId: 'card-1',
      versionId: 'version-2',
    });
  });

  it("refreshes the deck's cards and the card's history after a restore", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(
      within(versionBlock('Version 2')).getByRole('button', {
        name: 'Restore',
      }),
    );
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Restore',
      }),
    );

    expect(mockInvalidateCards).toHaveBeenCalledWith({ deckId: 'deck-1' });
    expect(mockInvalidateHistory).toHaveBeenCalledWith({ cardId: 'card-1' });
    expect(toast.success).toHaveBeenCalledWith('Restored version 2');
  });

  it('says so when a restore fails', async () => {
    mockRestoreMutation('error');
    const user = userEvent.setup();
    renderDialog();

    await user.click(
      within(versionBlock('Version 2')).getByRole('button', {
        name: 'Restore',
      }),
    );
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Restore',
      }),
    );

    expect(toast.error).toHaveBeenCalledWith('Version not found');
    expect(mockInvalidateCards).not.toHaveBeenCalled();
  });
});
