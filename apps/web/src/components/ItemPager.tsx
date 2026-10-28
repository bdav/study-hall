import { type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PAGER_BUTTON =
  'flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * Pages through a list one item at a time, such as a lesson's exercises:
 * which one of how many, and the way to the previous and next. It knows
 * nothing of the items, so any list can use it.
 */
export function ItemPager({
  noun,
  index,
  count,
  onMove,
  children,
}: {
  /** What an item is called, such as "exercise". */
  noun: string;
  index: number;
  count: number;
  onMove: (index: number) => void;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-white/60">
          {noun.charAt(0).toUpperCase() + noun.slice(1)} {index + 1} of {count}
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label={`Previous ${noun}`}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
            className={PAGER_BUTTON}
          >
            <ChevronLeft className="size-4" />
            Previous
          </button>
          <button
            type="button"
            aria-label={`Next ${noun}`}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
            className={PAGER_BUTTON}
          >
            Next
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
