import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/** A small arrow link above a page's title, to the page it sits under. */
export function BackLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"
    >
      <ArrowLeft className="size-4" />
      {children}
    </Link>
  );
}
