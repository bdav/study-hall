import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  GraduationCap,
  Layers,
  LogOut,
  Sparkles,
} from 'lucide-react';
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
  {
    to: '/ai-usage',
    label: 'AI usage',
    icon: Sparkles,
    prefixes: ['/ai-usage'],
    // Only learners who can use AI have any
    needsAI: true,
  },
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
  const me = trpc.auth.me.useQuery();
  const canUseAI = Boolean(me.data?.user?.canUseAI);
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      navigate('/login');
    },
    onError: () => {
      toast.error('Failed to log out');
    },
  });

  // On narrow screens the links are icons alone, padded to be easy to tap,
  // with their names kept for screen readers
  const baseLinkClass =
    'flex items-center gap-1.5 rounded-md p-2 text-sm font-medium transition-colors hover:text-white sm:p-0';
  const labelClass = 'sr-only sm:not-sr-only';
  const linkClass = `${baseLinkClass} text-white/70`;

  return (
    // The gutter switches where the page's does (PAGE_WIDTH), so Study Hall
    // lines up with the page below it; on narrow screens the links sit close, so
    // all five fit a 320px screen
    <nav className="flex items-center gap-1 px-4 py-2 sm:gap-4 sm:py-4 md:px-8">
      <Link
        to="/"
        className="text-lg font-bold tracking-wide whitespace-nowrap text-white"
      >
        Study Hall
      </Link>
      {AREAS.filter((area) => canUseAI || !area.needsAI).map(
        ({ to, label, icon: Icon, prefixes }) => {
          const current = isInArea(pathname, prefixes);
          return (
            <Link
              key={to}
              to={to}
              // An icon alone is marked by a soft background as well as colour
              className={`${baseLinkClass} ${current ? 'bg-white/15 text-white sm:bg-transparent' : 'text-white/70'}`}
              aria-current={current ? 'page' : undefined}
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span className={labelClass}>{label}</span>
            </Link>
          );
        },
      )}
      <div className="ml-auto">
        <button
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className={`${linkClass} cursor-pointer`}
        >
          <LogOut className="h-4 w-4" aria-hidden />
          <span className={labelClass}>Log out</span>
        </button>
      </div>
    </nav>
  );
}
