import { Link, useNavigate } from 'react-router-dom';
import { Home, BarChart3, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';

export function NavBar() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      navigate('/login');
    },
    onError: () => {
      toast.error('Failed to log out');
    },
  });

  const linkClass =
    'flex items-center gap-1.5 text-sm font-medium text-white/70 transition-colors hover:text-white';

  return (
    <nav className="flex items-center gap-4 px-8 py-4">
      <Link to="/" className="text-lg font-bold tracking-wide text-white">
        Study Hall
      </Link>
      <Link to="/" className={linkClass} aria-label="Home">
        <Home className="h-4 w-4" />
        Home
      </Link>
      <Link to="/stats" className={linkClass}>
        <BarChart3 className="h-4 w-4" />
        Stats
      </Link>
      <div className="ml-auto">
        <button
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className={`${linkClass} cursor-pointer`}
          aria-label="Log out"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </nav>
  );
}
