import { type ReactNode } from 'react';
import { PAGE_WIDTH } from '@/lib/layout';

/**
 * The written lesson's frame: a header pinned to the top, the outline on
 * the left (left out when collapsed; on mobile it's a drawer instead), the
 * step in the centre and the tutor on the right, which takes no space while
 * there's nothing in it. With the tutor open, the outline gives way to its
 * drawer until the screen has room for all three. The page scrolls, so a
 * long step is never cut off.
 */
export function LessonFrame({
  header,
  outline,
  tutor,
  children,
}: {
  header: ReactNode;
  /** Left out while the outline is collapsed. */
  outline?: ReactNode;
  tutor?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col text-white">
      {header}
      <div className={`flex flex-1 gap-8 ${PAGE_WIDTH}`}>
        {outline && (
          <aside
            className={`hidden w-60 shrink-0 ${tutor ? 'xl:block' : 'md:block'}`}
          >
            {/* Below the pinned header, scrolling on its own if it's long */}
            <div className="sticky top-20 max-h-[calc(100vh-5rem)] overflow-y-auto py-8">
              {outline}
            </div>
          </aside>
        )}
        <main className="flex min-w-0 flex-1 flex-col py-8">{children}</main>
        {tutor && (
          <aside
            aria-label="Tutor"
            className="hidden w-80 shrink-0 lg:block xl:w-96"
          >
            {/* Below the pinned header, its messages scrolling inside */}
            <div className="sticky top-20 h-[calc(100dvh-5rem)] py-6">
              {tutor}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
