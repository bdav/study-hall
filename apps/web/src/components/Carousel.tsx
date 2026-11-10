import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** How much of the width in view an arrow pages by, so a tile stays in view. */
const PAGE_BY = 0.9;

/** How far in from an edge with more tiles beyond it the row fades out. */
const FADE = '3rem';

/** Fades the row out at each edge with more tiles beyond it. */
function fadeMask(more: { back: boolean; forward: boolean }) {
  const edge = (faded: boolean) => (faded ? 'transparent' : 'black');
  const mask = `linear-gradient(to right, ${edge(more.back)}, black ${FADE}, black calc(100% - ${FADE}), ${edge(more.forward)})`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

/**
 * A row of tiles that scrolls sideways, fading out at an edge with more
 * beyond it: swiped on a touch screen, and paged with an arrow at either
 * end, shown on hover, when there's more that way.
 */
export function Carousel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ back: false, forward: false });

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    // A pixel's slack, as a scroll position can be a fraction off its end
    setMore({
      back: row.scrollLeft > 1,
      forward: row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
    });
  }, []);

  // Measured again whenever the row or a tile in it changes size, such as
  // when tiles are added; an observer reports each once as it starts
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const tile of row.children) observer.observe(tile);
    return () => observer.disconnect();
  }, [measure, children]);

  const page = (direction: 1 | -1) =>
    rowRef.current?.scrollBy({
      left: direction * rowRef.current.clientWidth * PAGE_BY,
    });

  return (
    <div className="group/carousel relative">
      <ul
        ref={rowRef}
        aria-label={label}
        onScroll={measure}
        style={fadeMask(more)}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain scroll-smooth py-2 [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>
      {more.back && (
        <CarouselArrow side="back" label={label} onClick={() => page(-1)} />
      )}
      {more.forward && (
        <CarouselArrow side="forward" label={label} onClick={() => page(1)} />
      )}
    </div>
  );
}

/** One tile of a Carousel. */
export function CarouselItem({ children }: { children: ReactNode }) {
  return <li className="w-64 shrink-0 snap-start sm:w-72">{children}</li>;
}

function CarouselArrow({
  side,
  label,
  onClick,
}: {
  side: 'back' | 'forward';
  label: string;
  onClick: () => void;
}) {
  const Icon = side === 'back' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={`Scroll ${label} ${side}`}
      onClick={onClick}
      // Touch screens swipe, so have none
      className={`absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover/carousel:opacity-100 hover:bg-black/70 focus-visible:opacity-100 pointer-coarse:hidden ${side === 'back' ? '-left-2' : '-right-2'}`}
    >
      <Icon className="size-6" aria-hidden />
    </button>
  );
}
