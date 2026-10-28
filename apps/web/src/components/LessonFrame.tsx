import { type ReactNode } from 'react';

/**
 * The written lesson's frame: a header pinned to the top, the outline on
 * the left (left out when collapsed; on mobile it's a drawer instead), the
 * step in the centre and the tutor on the right, which takes no space while
 * there's nothing in it. The page scrolls, so a long step is never cut off.
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
      <div className="flex flex-1 gap-8 px-4 md:px-8">
        {outline && (
          <aside className="hidden w-60 shrink-0 md:block">
            {/* Below the pinned header, scrolling on its own if it's long */}
            <div className="sticky top-20 max-h-[calc(100vh-5rem)] overflow-y-auto py-8">
              {outline}
            </div>
          </aside>
        )}
        <main className="min-w-0 flex-1 py-8">{children}</main>
        {tutor && (
          <aside aria-label="Tutor" className="hidden w-80 shrink-0 lg:block">
            <div className="sticky top-20 py-8">{tutor}</div>
          </aside>
        )}
      </div>
    </div>
  );
}
