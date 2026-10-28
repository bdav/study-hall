import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc';

const glassInputClassName =
  'mt-1 border-white/20 bg-white/10 text-white placeholder-white/40 focus-visible:border-white/40 focus-visible:ring-white/20';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();

  const login = trpc.auth.login.useMutation({
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
    if (!email.trim() || !password) return;
    login.mutate({ email: email.trim(), password });
  }

  return (
    <div className="bg-ocean-gradient flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-white/10 bg-white/5 px-6 py-8 shadow-xl backdrop-blur-md">
        <h1 className="text-center text-2xl font-bold text-white">Log In</h1>

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

          {login.isError && (
            <p className="text-sm text-red-400">{login.error.message}</p>
          )}

          <button
            type="submit"
            disabled={login.isPending}
            className="w-full rounded-lg bg-white/20 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-50"
          >
            {login.isPending ? 'Logging in…' : 'Log In'}
          </button>
        </form>

        <p className="text-center text-sm text-white/60">
          Don&apos;t have an account?{' '}
          <Link
            to="/signup"
            className="text-white/80 underline hover:text-white"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
