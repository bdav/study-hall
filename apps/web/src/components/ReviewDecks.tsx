import { useId } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { dueAndNew } from '@/lib/decks';

type ReviewDeck =
  inferRouterOutputs<AppRouter>['today']['get']['review']['decks'][number];

/**
 * Today's Review's decks, below its title card before a review (#116): each
 * deck Review lists, with its counts and a tickbox choosing whether a review
 * takes it, and Select all, or Select none once every one is ticked. An
 * unticked deck stays, so it can be ticked again.
 */
export function ReviewDecks({
  decks,
  onTick,
}: {
  decks: ReviewDeck[];
  /** Ticks or unticks decks (`useSetDecksTicked`). */
  onTick: (choice: { deckIds: string[]; ticked: boolean }) => void;
}) {
  const headingId = useId();
  const allTicked = decks.every((deck) => deck.ticked);
  const noneTicked = !decks.some((deck) => deck.ticked);

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="mx-auto mt-6 w-full max-w-md"
    >
      <div className="flex items-baseline justify-between gap-4">
        <p id={headingId} className="text-sm font-medium text-white/80">
          Decks to review
        </p>
        {decks.length > 0 && (
          <button
            type="button"
            onClick={() =>
              onTick({
                deckIds: decks.map((deck) => deck.id),
                ticked: !allTicked,
              })
            }
            className="touch-target cursor-pointer text-sm text-white/60 hover:text-white"
          >
            {allTicked ? 'Select none' : 'Select all'}
          </button>
        )}
      </div>
      {decks.length === 0 ? (
        <p className="mt-2 text-sm text-white/50">
          No deck has cards due or new.
        </p>
      ) : (
        <>
          {noneTicked && (
            <p className="mt-1 text-sm text-white/50">
              No deck ticked to review
            </p>
          )}
          {/* Clear of Select all's tap area on a touch screen */}
          <ul className="mt-2 space-y-1 pointer-coarse:mt-3 pointer-coarse:space-y-0">
            {decks.map((deck) => (
              <li key={deck.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1 hover:bg-white/5 pointer-coarse:min-h-touch">
                  <input
                    type="checkbox"
                    checked={deck.ticked}
                    onChange={(e) =>
                      onTick({ deckIds: [deck.id], ticked: e.target.checked })
                    }
                    aria-label={`Review ${deck.name}`}
                    className="size-4 shrink-0 accent-white"
                  />
                  <span
                    className={`min-w-0 flex-1 break-words ${deck.ticked ? 'text-white' : 'text-white/50'}`}
                  >
                    {deck.name}
                  </span>
                  <span className="shrink-0 text-xs text-white/50">
                    {dueAndNew(deck)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
