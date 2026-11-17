import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavBar } from './NavBar';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      auth: { me: { cancel: vi.fn(), setData: vi.fn() } },
    })),
    auth: {
      logout: { useMutation: vi.fn() },
      me: { useQuery: vi.fn() },
    },
    aiUsage: { summary: { useQuery: vi.fn() } },
  },
}));

function renderNavBar(path = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <NavBar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function signedIn({ canUseAI }: { canUseAI: boolean }) {
  vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
    data: { user: { id: 'user-1', email: 'me@example.com', canUseAI } },
  } as unknown as ReturnType<typeof trpc.auth.me.useQuery>);
}

/** The learner's own AI spend this month, as `aiUsage.summary` gives it. */
function spend(summary = { spentUsd: 1.2, capUsd: 10, paused: false }) {
  vi.mocked(trpc.aiUsage.summary.useQuery).mockReturnValue({
    data: summary,
  } as unknown as ReturnType<typeof trpc.aiUsage.summary.useQuery>);
}

function setupMocks() {
  signedIn({ canUseAI: true });
  spend();
  vi.mocked(trpc.auth.logout.useMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof trpc.auth.logout.useMutation>);
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMocks();
});

describe('NavBar', () => {
  it('links Home first of the areas, and Study Hall to it', () => {
    renderNavBar('/courses');

    const links = screen
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links.slice(0, 3)).toEqual([
      ['Study Hall', '/'],
      ['Home', '/'],
      ['Courses', '/courses'],
    ]);
  });

  it('marks Home as current on Home alone', () => {
    renderNavBar('/');

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const name of ['Courses', 'Flashcards', 'Stats', 'AI usage']) {
      expect(screen.getByRole('link', { name })).not.toHaveAttribute(
        'aria-current',
      );
    }
  });

  it("isn't on Home anywhere else", () => {
    renderNavBar('/decks/deck-1');

    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: 'Study Hall' })).not.toHaveClass(
      'max-sm:underline',
    );
  });

  it('leaves Home to Study Hall on narrow screens, so the bar still fits 320px, marking Study Hall there on Home', () => {
    renderNavBar('/');

    expect(screen.getByRole('link', { name: 'Home' })).toHaveClass(
      'max-sm:hidden',
    );
    const studyHall = screen.getByRole('link', { name: 'Study Hall' });
    expect(studyHall).toHaveClass('max-sm:underline');
    // Home alone is current, so screen readers hear one
    expect(studyHall).not.toHaveAttribute('aria-current');
  });

  it('renders Courses and Flashcards as peer areas', () => {
    renderNavBar();

    expect(screen.getByRole('link', { name: 'Courses' })).toHaveAttribute(
      'href',
      '/courses',
    );
    expect(screen.getByRole('link', { name: 'Flashcards' })).toHaveAttribute(
      'href',
      '/flashcards',
    );
  });

  it('marks Flashcards as the current area on a deck page', () => {
    renderNavBar('/decks/deck-1/cards');

    expect(screen.getByRole('link', { name: 'Flashcards' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Courses' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('marks Courses as the current area on a course page', () => {
    renderNavBar('/courses/course-1');

    expect(screen.getByRole('link', { name: 'Courses' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('renders Stats link pointing to /stats', () => {
    renderNavBar();

    const statsLink = screen.getByRole('link', { name: /stats/i });
    expect(statsLink).toHaveAttribute('href', '/stats');
  });

  it('links AI usage, right after Stats, for learners who can use AI', () => {
    renderNavBar();

    const links = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(links.slice(links.indexOf('/stats'))).toEqual([
      '/stats',
      '/ai-usage',
    ]);
    expect(screen.getByRole('link', { name: 'AI usage' })).toHaveAttribute(
      'href',
      '/ai-usage',
    );
  });

  it('marks AI usage as the current area on its page', () => {
    renderNavBar('/ai-usage');

    expect(screen.getByRole('link', { name: 'AI usage' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it("leaves AI usage out for learners who can't use AI", () => {
    signedIn({ canUseAI: false });
    renderNavBar();

    expect(
      screen.queryByRole('link', { name: 'AI usage' }),
    ).not.toBeInTheDocument();
  });

  it('renders a Log out button', () => {
    renderNavBar();

    expect(
      screen.getByRole('button', { name: /log out/i }),
    ).toBeInTheDocument();
  });

  it('calls logout mutation when Log out is clicked', async () => {
    const mockMutate = vi.fn();
    vi.mocked(trpc.auth.logout.useMutation).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof trpc.auth.logout.useMutation>);

    const user = userEvent.setup();
    renderNavBar();

    await user.click(screen.getByRole('button', { name: /log out/i }));

    expect(mockMutate).toHaveBeenCalled();
  });

  it('forgets a new course left half set up on logging out, so the next account starts afresh', async () => {
    sessionStorage.setItem('new-course:stage', '{"step":"interview"}');
    sessionStorage.setItem(
      'new-course:interview',
      '{"opening":"Italian","rounds":[],"current":null}',
    );
    renderNavBar();

    const options = vi.mocked(trpc.auth.logout.useMutation).mock
      .lastCall![0] as { onSuccess: () => Promise<void> };
    await options.onSuccess();

    expect(sessionStorage.getItem('new-course:stage')).toBeNull();
    expect(sessionStorage.getItem('new-course:interview')).toBeNull();
  });

  it('shows the areas and Log out as icons alone on narrow screens, keeping their names', () => {
    renderNavBar();

    for (const name of ['Courses', 'Flashcards', 'Stats', 'AI usage']) {
      const link = screen.getByRole('link', { name });
      expect(within(link).getByText(name)).toHaveClass(
        'sr-only',
        'sm:not-sr-only',
      );
    }
    const logOut = screen.getByRole('button', { name: 'Log out' });
    expect(within(logOut).getByText('Log out')).toHaveClass(
      'sr-only',
      'sm:not-sr-only',
    );
  });

  it('sets the current area on a soft background on narrow screens, where it is an icon alone', () => {
    renderNavBar('/stats');

    expect(screen.getByRole('link', { name: 'Stats' })).toHaveClass(
      'bg-white/15',
      'sm:bg-transparent',
    );
    expect(screen.getByRole('link', { name: 'Courses' })).not.toHaveClass(
      'bg-white/15',
    );
  });

  it('keeps Study Hall on one line', () => {
    renderNavBar();

    expect(screen.getByRole('link', { name: 'Study Hall' })).toHaveClass(
      'whitespace-nowrap',
    );
  });

  describe('AI spend (#119)', () => {
    const spendButton = (name: RegExp = /^AI spend this month/) =>
      screen.getByRole('button', { name });
    const panel = () => screen.findByRole('dialog');

    async function expectSpendPanel() {
      const opened = await panel();
      expect(
        within(opened).getByText('Your AI this month: $1.20 of $10.00'),
      ).toBeInTheDocument();
      expect(
        within(opened).getByRole('link', { name: 'See AI usage' }),
      ).toHaveAttribute('href', '/ai-usage');
      return opened;
    }

    it("shows the learner's own spend against their cap on hover, with a link to AI usage", async () => {
      const user = userEvent.setup();
      renderNavBar();
      expect(screen.queryByRole('dialog')).toBeNull();

      await user.hover(spendButton());

      const opened = await expectSpendPanel();
      expect(within(opened).queryByText(/paused/i)).toBeNull();
    });

    it('shows it on focus', async () => {
      renderNavBar();

      act(() => spendButton().focus());

      await expectSpendPanel();
      // Focus stays where it was, so Tab goes on through the bar
      expect(spendButton()).toHaveFocus();
    });

    it('closes on Escape from its link, focus back on the icon, and stays closed', async () => {
      const user = userEvent.setup();
      renderNavBar();
      act(() => spendButton().focus());
      const link = within(await expectSpendPanel()).getByRole('link', {
        name: 'See AI usage',
      });
      act(() => link.focus());

      await user.keyboard('{Escape}');

      expect(spendButton()).toHaveFocus();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('leaves focus where it was when it closes after a hover', async () => {
      const user = userEvent.setup();
      renderNavBar();
      const logOut = screen.getByRole('button', { name: 'Log out' });
      act(() => logOut.focus());

      await user.hover(spendButton());
      await expectSpendPanel();
      await user.unhover(spendButton());
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(logOut).toHaveFocus();
    });

    it('closes once its link is followed, staying closed', async () => {
      const user = userEvent.setup();
      renderNavBar();
      await user.hover(spendButton());

      await user.click(
        within(await expectSpendPanel()).getByRole('link', {
          name: 'See AI usage',
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('takes Tab from the icon to its link, then on through the bar, closing', async () => {
      const user = userEvent.setup();
      renderNavBar();
      act(() => spendButton().focus());
      await expectSpendPanel();

      await user.tab();
      expect(screen.getByRole('link', { name: 'See AI usage' })).toHaveFocus();
      await user.tab();

      expect(screen.getByRole('button', { name: 'Log out' })).toHaveFocus();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('shows it on a tap, as a touch screen has no hover', async () => {
      const user = userEvent.setup();
      renderNavBar();

      await user.pointer({ keys: '[TouchA]', target: spendButton() });

      await expectSpendPanel();
    });

    it('marks the icon while AI is paused, and says so', async () => {
      spend({ spentUsd: 10.3, capUsd: 10, paused: true });
      const user = userEvent.setup();
      renderNavBar();

      const button = spendButton(/^AI spend this month, AI paused$/);
      expect(button.querySelector('[data-paused-mark]')).not.toBeNull();
      await user.hover(button);

      const opened = await panel();
      expect(
        within(opened).getByText('Your AI this month: $10.30 of $10.00'),
      ).toBeInTheDocument();
      expect(
        within(opened).getByText(/ai features are paused/i),
      ).toBeInTheDocument();
    });

    it("isn't marked while AI isn't paused", () => {
      renderNavBar();

      expect(spendButton().querySelector('[data-paused-mark]')).toBeNull();
    });

    it("never shows to learners who can't use AI, nor asks for their spend", () => {
      signedIn({ canUseAI: false });
      renderNavBar();

      expect(screen.queryByRole('button', { name: /AI spend/ })).toBeNull();
      expect(trpc.aiUsage.summary.useQuery).toHaveBeenCalledWith(undefined, {
        enabled: false,
      });
    });

    it('stands in for the AI usage link on narrow screens, so the bar still fits 320px', () => {
      renderNavBar('/ai-usage');

      expect(screen.getByRole('link', { name: 'AI usage' })).toHaveClass(
        'max-sm:hidden',
      );
      // Marked there as the current area, as the link is from sm
      expect(spendButton()).toHaveClass('max-sm:bg-white/15');
    });
  });
});
