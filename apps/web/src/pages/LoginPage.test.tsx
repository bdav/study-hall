import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from './LoginPage';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      me: { useQuery: vi.fn() },
      login: { useMutation: vi.fn() },
    },
  },
}));

function renderLoginPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Home Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setupMocks(overrides?: {
  isPending?: boolean;
  error?: { message: string };
}) {
  vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
    data: { user: null },
    isLoading: false,
  } as unknown as ReturnType<typeof trpc.auth.me.useQuery>);

  vi.mocked(trpc.auth.login.useMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: overrides?.isPending ?? false,
    isError: overrides?.error !== undefined,
    error: overrides?.error ?? null,
  } as unknown as ReturnType<typeof trpc.auth.login.useMutation>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  it('renders email and password inputs and a login button', () => {
    setupMocks();
    renderLoginPage();

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('renders a link to the signup page', () => {
    setupMocks();
    renderLoginPage();

    const signupLink = screen.getByRole('link', { name: /sign up/i });
    expect(signupLink).toHaveAttribute('href', '/signup');
  });

  it('calls login mutation with email and password on submit', async () => {
    const mockMutate = vi.fn();
    vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
      data: { user: null },
      isLoading: false,
    } as unknown as ReturnType<typeof trpc.auth.me.useQuery>);
    vi.mocked(trpc.auth.login.useMutation).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof trpc.auth.login.useMutation>);

    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(mockMutate).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
    });
  });

  it('does not submit with empty fields', async () => {
    const mockMutate = vi.fn();
    vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
      data: { user: null },
      isLoading: false,
    } as unknown as ReturnType<typeof trpc.auth.me.useQuery>);
    vi.mocked(trpc.auth.login.useMutation).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof trpc.auth.login.useMutation>);

    const user = userEvent.setup();
    renderLoginPage();

    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('redirects to home when user is already authenticated', () => {
    setupMocks();
    vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
      data: { user: { id: '1', email: 'test@example.com' } },
      isLoading: false,
    } as unknown as ReturnType<typeof trpc.auth.me.useQuery>);
    renderLoginPage();

    expect(screen.getByText('Home Page')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /log in/i }),
    ).not.toBeInTheDocument();
  });

  it('displays error message when login fails', () => {
    setupMocks({ error: { message: 'Invalid credentials' } });

    renderLoginPage();

    expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
  });

  it('says to wait after too many attempts', () => {
    setupMocks({
      error: {
        message: 'Too many attempts. Please wait 15 minutes and try again.',
      },
    });

    renderLoginPage();

    expect(
      screen.getByText(
        'Too many attempts. Please wait 15 minutes and try again.',
      ),
    ).toBeInTheDocument();
  });

  it('disables the submit button while login is pending', () => {
    setupMocks({ isPending: true });
    renderLoginPage();

    expect(screen.getByRole('button', { name: /logging in/i })).toBeDisabled();
  });
});
