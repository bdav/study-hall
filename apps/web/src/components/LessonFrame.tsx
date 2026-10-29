import { useCallback, type ReactNode } from 'react';
import {
  DOCKED_PANEL_SLIDE,
  DOCKED_PANEL_WIDTH,
  PAGE_WIDTH_BESIDE_PANEL,
} from '@/lib/layout';

/**
 * The written lesson's frame: a header pinned to the top, the outline on
 * the left (left out when collapsed; on mobile it's a drawer instead), the
 * step in the centre and the tutor docked at the window's right edge, which
 * slides in and out and takes no space while closed. With the tutor open,
 * the outline gives way to its drawer until the screen has room for all
 * three. The page scrolls, so a long step is never cut off.
 */
export function LessonFrame({
  header,
  outline,
  tutor,
  tutorOpen = false,
  children,
}: {
  header: ReactNode;
  /** Left out while the outline is collapsed. */
  outline?: ReactNode;
  /** Left out where the tutor is a drawer instead. */
  tutor?: ReactNode;
  /** Kept in place while closed, so it slides and keeps its state. */
  tutorOpen?: boolean;
  children: ReactNode;
}) {
  // The tutor fills the screen from where it starts down to the bottom, so
  // its box to ask in is always in view: below the site's navigation at the
  // top of the page, and taller once that has scrolled away. Set directly,
  // as the page scrolls, rather than through renders, on whichever element
  // is mounted
  const fillToBottom = useCallback((panel: HTMLDivElement | null) => {
    if (!panel) return;
    const fit = () => {
      panel.style.height = `${window.innerHeight - panel.getBoundingClientRect().top}px`;
    };
    fit();
    window.addEventListener('scroll', fit, { passive: true });
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
    };
  }, []);

  return (
    <div className="flex flex-1 flex-col text-white">
      {header}
      <div className="flex flex-1">
        <div className={`flex min-w-0 flex-1 gap-8 ${PAGE_WIDTH_BESIDE_PANEL}`}>
          {outline && (
            <aside
              className={`hidden w-60 shrink-0 ${tutorOpen ? 'xl:block' : 'md:block'}`}
            >
              {/* Below the pinned header, scrolling on its own if it's long */}
              <div className="sticky top-20 max-h-[calc(100vh-5rem)] overflow-y-auto py-8">
                {outline}
              </div>
            </aside>
          )}
          <main className="flex min-w-0 flex-1 flex-col py-8">{children}</main>
        </div>
        {tutor && (
          <aside
            aria-label="Tutor"
            aria-hidden={!tutorOpen}
            inert={!tutorOpen}
            // Clipped, not hidden, which would stop the panel sticking
            className={`relative hidden shrink-0 overflow-x-clip lg:block ${DOCKED_PANEL_SLIDE} ${tutorOpen ? DOCKED_PANEL_WIDTH : 'w-0'}`}
          >
            {/* Out of the page's flow, so the tutor never makes it taller
                and pushes the step's footer down. Held at the right edge,
                so opening reveals it from there as it slides in */}
            <div className={`absolute inset-y-0 right-0 ${DOCKED_PANEL_WIDTH}`}>
              {/* Below the pinned header, its messages scrolling inside */}
              <div
                ref={fillToBottom}
                className="sticky top-20 border-l border-white/15 p-6"
              >
                {tutor}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
