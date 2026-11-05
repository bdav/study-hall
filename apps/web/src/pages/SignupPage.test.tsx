import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SignupPage from './SignupPage';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      auth: { me: { invalidate: vi.fn() } },
    })),
    auth: {
      me: { useQuery: vi.fn() },
      signup: { useMutation: vi.fn() },
    },
  },
}));

function renderSignupPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/signup']}>
        <Routes>
          <Route path="/signup" element={<SignupPage />} />
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

  vi.mocked(trpc.auth.signup.useMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: overrides?.isPending ?? false,
    isError: overrides?.error !== undefined,
    error: overrides?.error ?? null,
  } as unknown as ReturnType<typeof trpc.auth.signup.useMutation>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SignupPage', () => {
  it('renders email, password, and confirm password inputs and a signup button', () => {
    setupMocks();
    renderSignupPage();

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sign up/i }),
    ).toBeInTheDocument();
  });

  it('renders a link to the login page', () => {
    setupMocks();
    renderSignupPage();

    const loginLink = screen.getByRole('link', { name: /log in/i });
    expect(loginLink).toHaveAttribute('href', '/login');
  });

  it('calls signup mutation with email and password on submit', async () => {
    const mockMutate = vi.fn();
    vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
      data: { user: null },
      isLoading: false,
    } as unknown as ReturnType<typeof trpc.auth.me.useQuery>);
    vi.mocked(trpc.auth.signup.useMutation).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof trpc.auth.signup.useMutation>);

    const user = userEvent.setup();
    renderSignupPage();

    await user.type(screen.getByLabelText(/email/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    expect(mockMutate).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'password123',
    });
  });

  it('shows error when passwords do not match', async () => {
    setupMocks();
    const user = userEvent.setup();
    renderSignupPage();

    await user.type(screen.getByLabelText(/email/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'different');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
  });

  it('shows error when password is too short', async () => {
    setupMocks();
    const user = userEvent.setup();
    renderSignupPage();

    await user.type(screen.getByLabelText(/email/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'short');
    await user.type(screen.getByLabelText(/confirm password/i), 'short');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it('does not submit with empty fields', async () => {
    const mockMutate = vi.fn();
    vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
      data: { user: null },
      isLoading: false,
    } as unknown as ReturnType<typeof trpc.auth.me.useQuery>);
    vi.mocked(trpc.auth.signup.useMutation).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof trpc.auth.signup.useMutation>);

    const user = userEvent.setup();
    renderSignupPage();

    await user.click(screen.getByRole('button', { name: /sign up/i }));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('redirects to home when user is already authenticated', () => {
    setupMocks();
    vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
      data: { user: { id: '1', email: 'test@example.com' } },
      isLoading: false,
    } as unknown as ReturnType<typeof trpc.auth.me.useQuery>);
    renderSignupPage();

    expect(screen.getByText('Home Page')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /sign up/i }),
    ).not.toBeInTheDocument();
  });

  it('displays error message when signup fails', () => {
    setupMocks({ error: { message: 'Email already in use' } });

    renderSignupPage();

    expect(screen.getByText(/email already in use/i)).toBeInTheDocument();
  });

  it('says signup is by invitation when the email is refused', () => {
    setupMocks({ error: { message: 'Signup is by invitation only.' } });

    renderSignupPage();

    expect(
      screen.getByText('Signup is by invitation only.'),
    ).toBeInTheDocument();
  });

  it('disables the submit button while signup is pending', () => {
    setupMocks({ isPending: true });
    renderSignupPage();

    expect(screen.getByRole('button', { name: /signing up/i })).toBeDisabled();
  });
});
