import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc';

const glassInputClassName =
  'mt-1 border-white/20 bg-white/10 text-white placeholder-white/40 focus-visible:border-white/40 focus-visible:ring-white/20';

const MIN_PASSWORD_LENGTH = 8;

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();

  const signup = trpc.auth.signup.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      navigate('/');
    },
  });

  if (me.data?.user) {
    return <Navigate to="/" replace />;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordError('');

    if (!email.trim() || !password || !confirmPassword) return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
      return;
    }

    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    signup.mutate({ email: email.trim(), password });
  }

  return (
    <div className="bg-ocean-gradient flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-white/10 bg-white/5 px-6 py-8 shadow-xl backdrop-blur-md">
        <h1 className="text-center text-2xl font-bold text-white">Sign Up</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-white/80"
            >
              Email
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={glassInputClassName}
              required
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-white/80"
            >
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={glassInputClassName}
              required
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-white/80"
            >
              Confirm Password
            </label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={glassInputClassName}
              required
            />
          </div>

          {passwordError && (
            <p className="text-sm text-red-400">{passwordError}</p>
          )}

          {signup.isError && (
            <p className="text-sm text-red-400">{signup.error.message}</p>
          )}

          <button
            type="submit"
            disabled={signup.isPending}
            className="w-full rounded-lg bg-white/20 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-50"
          >
            {signup.isPending ? 'Signing up…' : 'Sign Up'}
          </button>
        </form>

        <p className="text-center text-sm text-white/60">
          Already have an account?{' '}
          <Link
            to="/login"
            className="text-white/80 underline hover:text-white"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
