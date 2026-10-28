import { type ReactNode } from 'react';
import { BackLink } from '@/components/BackLink';
import { PAGE_WIDTH } from '@/lib/layout';

/**
 * A page's header, pinned to the top as the learner scrolls: the way back,
 * the title and, on the right, the page's actions. Courses and lessons
 * share it, aligned to the same width, so moving between them keeps the
 * title in place.
 */
export function PinnedHeader({
  back,
  title,
  subtitle,
  leading,
  children,
}: {
  back: { to: string; label: string };
  title: string;
  /** A line under the title, left out on narrow screens for room. */
  subtitle?: string;
  /**
   * What goes before the title, such as the button that opens a lesson's
   * outline on narrow screens. Hidden, it takes no space, so titles line up
   * on wide screens.
   */
  leading?: ReactNode;
  /** The page's actions, on the right. */
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/15 bg-[oklch(0.3_0.1_228)]/90 py-3 backdrop-blur-md">
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${PAGE_WIDTH}`}
      >
        {leading}
        <div className="min-w-0 flex-1">
          <BackLink to={back.to}>{back.label}</BackLink>
          <h1
            title={title}
            className="line-clamp-2 text-lg font-bold md:line-clamp-1 md:text-xl"
          >
            {title}
          </h1>
          {subtitle && (
            <p className="hidden truncate text-sm text-white/60 sm:block">
              {subtitle}
            </p>
          )}
        </div>
        {children}
      </div>
    </header>
  );
}
