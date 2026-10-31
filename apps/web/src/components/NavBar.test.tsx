import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavBar } from './NavBar';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      auth: { me: { invalidate: vi.fn() } },
    })),
    auth: {
      logout: { useMutation: vi.fn() },
      me: { useQuery: vi.fn() },
    },
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

function setupMocks() {
  signedIn({ canUseAI: true });
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

  it('forgets a new course left half set up on logging out, so the next account starts afresh', () => {
    sessionStorage.setItem('new-course:stage', '{"step":"interview"}');
    sessionStorage.setItem(
      'new-course:interview',
      '{"opening":"Italian","rounds":[],"current":null}',
    );
    renderNavBar();

    const options = vi.mocked(trpc.auth.logout.useMutation).mock
      .lastCall![0] as { onSuccess: () => void };
    options.onSuccess();

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
});
