import { useId, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { recallGradeColors, recallGradeLabels } from '@/lib/recallGrades';
import { answeredLine, formatDay } from '@/lib/format';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// How many of the current version's answers show
const RECENT_ANSWERS = 5;

// The progress a learner sees, in plain words; never the mastery score
const lifecycleLabels: Record<
  'NEW' | 'LEARNING' | 'STABLE' | 'RETIRED',
  string
> = {
  NEW: 'New',
  LEARNING: 'Still learning',
  STABLE: 'Well learned',
  RETIRED: 'Retired',
};

const relative = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

/** "Next review in 2 days", or that it's due now; nothing when unscheduled. */
function nextReview(dueAt: string | null) {
  if (!dueAt) return null;
  const minutes = (new Date(dueAt).getTime() - Date.now()) / 60_000;
  if (minutes <= 0) return 'Due now';
  if (minutes < 60) {
    const inMinutes = Math.max(1, Math.round(minutes));
    return `Next review ${relative.format(inMinutes, 'minute')}`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    return `Next review ${relative.format(Math.round(hours), 'hour')}`;
  }
  return `Next review ${relative.format(Math.round(hours / 24), 'day')}`;
}

// The picker's choice for attempts from before versions were recorded
const BEFORE = 'before';

/**
 * The learner's history with a card, below it once answered (ADR-0008): for
 * its current Card Version, the recent answers with their final grades and
 * dates, how many were right, its state in plain words and, unless told
 * not to, when it's next due; a picker of version numbers shows an earlier version instead, as a
 * block of its front and each answer with the Accepted Variants it ended
 * with, above the answers given to it. Read only.
 */
export function CardHistory({
  cardId,
  showsNextReview = true,
}: {
  cardId: string;
  /** Off while the card is still to come back in the Study Session. */
  showsNextReview?: boolean;
}) {
  const headingId = useId();
  // A Card Version's id, or BEFORE; the current version until chosen
  const [chosen, setChosen] = useState<string | null>(null);
  // Not kept once off screen, so it always comes with the answer just given
  const query = trpc.card.history.useQuery({ cardId }, { gcTime: 0 });
  const history = query.data;

  if (query.isError) {
    return (
      <p className="mt-6 text-sm text-white/60">
        Couldn&apos;t load your history with this card.
      </p>
    );
  }
  if (!history) return null;

  const [current] = history.versions;
  const first = history.versions[history.versions.length - 1];
  const version = history.versions.find((v) => v.id === chosen) ?? current;
  const shown = chosen === BEFORE ? history.unversioned : version;
  const hasEarlier =
    history.versions.length > 1 || history.unversioned !== null;
  const isCurrent = shown === current;
  const attempts = isCurrent
    ? (shown?.attempts ?? []).slice(0, RECENT_ANSWERS)
    : (shown?.attempts ?? []);
  const state =
    history.progress &&
    [
      lifecycleLabels[history.progress.lifecycleState],
      showsNextReview && nextReview(history.progress.dueAt),
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto mt-6 w-full max-w-md rounded-xl border border-white/20 bg-white/5 p-3 text-left text-sm text-white/80"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id={headingId}
          className="text-xs uppercase tracking-wide text-white/50"
        >
          Your history with this card
        </h2>
        {hasEarlier && (
          <Select value={chosen ?? current.id} onValueChange={setChosen}>
            <SelectTrigger
              size="sm"
              aria-label="Card version"
              className="border-white/20 bg-white/10 text-xs text-white hover:bg-white/15 [&_svg]:text-white/60"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              position="popper"
              align="end"
              className="border border-white/20 bg-[oklch(0.25_0.08_230)] text-white ring-0"
            >
              {history.versions.map((v) => (
                <SelectItem
                  key={v.id}
                  value={v.id}
                  className="text-xs focus:bg-white/10 focus:text-white"
                >
                  Version {v.number}
                  {v.isCurrent && ' (current)'}
                </SelectItem>
              ))}
              {history.unversioned && (
                <SelectItem
                  value={BEFORE}
                  className="text-xs focus:bg-white/10 focus:text-white"
                >
                  Before version {first.number}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
      </div>

      {!isCurrent && chosen !== BEFORE && (
        // The earlier version as it was: its front, and each answer with the
        // Accepted Variants it ended with
        <div
          role="group"
          aria-label={`Version ${version.number}`}
          className="mt-3 rounded-lg border border-white/20 bg-white/10 p-3 text-center"
        >
          <p className="font-semibold uppercase tracking-wide text-white">
            {version.front}
          </p>
          <div className="mt-2 space-y-1">
            {version.canonicalAnswers.map((answer, i) => {
              const variants = version.acceptedVariants?.[i] ?? [];
              return (
                <div key={answer}>
                  <p className="text-white">{answer}</p>
                  {variants.length > 0 && (
                    <p className="text-xs text-white/50">
                      Variants: {variants.join(', ')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {version.acceptedVariants === null && (
            <p className="mt-2 text-xs text-white/50">
              Variants weren’t recorded for this version.
            </p>
          )}
        </div>
      )}
      {isCurrent && state && <p className="mt-2 text-white">{state}</p>}
      {shown && (
        <p className="mt-1 text-white/60">
          {answeredLine(shown.answeredCount, shown.rightCount)}
        </p>
      )}

      {attempts.length > 0 && (
        <ol className="mt-2 space-y-1">
          {attempts.map((attempt) => (
            <li key={attempt.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-white">
                {attempt.userAnswer ?? "I don't know"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs text-white ${recallGradeColors[attempt.recallGrade]}`}
              >
                {recallGradeLabels[attempt.recallGrade]}
              </span>
              <span className="text-xs text-white/50">
                {formatDay(attempt.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
