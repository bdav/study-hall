import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, GraduationCap, Layers, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';

/** The top-level areas, each owning the paths that start with its prefixes. */
const AREAS = [
  {
    to: '/courses',
    label: 'Courses',
    icon: GraduationCap,
    prefixes: ['/courses'],
  },
  {
    to: '/flashcards',
    label: 'Flashcards',
    icon: Layers,
    prefixes: ['/flashcards', '/decks'],
  },
  { to: '/stats', label: 'Stats', icon: BarChart3, prefixes: ['/stats'] },
];

function isInArea(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function NavBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
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

  const baseLinkClass =
    'flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-white';
  const linkClass = `${baseLinkClass} text-white/70`;

  return (
    <nav className="flex items-center gap-4 px-8 py-4">
      <Link to="/" className="text-lg font-bold tracking-wide text-white">
        Study Hall
      </Link>
      {AREAS.map(({ to, label, icon: Icon, prefixes }) => {
        const current = isInArea(pathname, prefixes);
        return (
          <Link
            key={to}
            to={to}
            className={`${baseLinkClass} ${current ? 'text-white' : 'text-white/70'}`}
            aria-current={current ? 'page' : undefined}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
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
