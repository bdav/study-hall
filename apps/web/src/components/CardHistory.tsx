import { useId, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { recallGradeColors, recallGradeLabels } from '@/lib/recallGrades';

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

const dayFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});
const relative = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

function formatDay(date: string) {
  return dayFormat.format(new Date(date));
}

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

function answeredLine(answeredCount: number, rightCount: number) {
  const times = answeredCount === 1 ? 'time' : 'times';
  return `Answered ${answeredCount} ${times} · ${rightCount} right`;
}

const EARLIER = 'An earlier version';

/**
 * The learner's history with a card, below it once answered (ADR-0008): for
 * its current Card Version, the recent answers with their final grades and
 * dates, how many were right, its state in plain words and when it's next
 * due; a picker shows an earlier version's front, answers and answers given
 * instead. Read only.
 */
export function CardHistory({ cardId }: { cardId: string }) {
  const headingId = useId();
  const [chosen, setChosen] = useState('current');
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

  const [current, ...earlier] = history.versions;
  const version =
    chosen === 'current'
      ? current
      : history.versions.find((v) => v.id === chosen);
  const shown = chosen === EARLIER ? history.unversioned : (version ?? current);
  const hasEarlier = earlier.length > 0 || history.unversioned !== null;
  const isCurrent = shown === current;
  const attempts = isCurrent
    ? (shown?.attempts ?? []).slice(0, RECENT_ANSWERS)
    : (shown?.attempts ?? []);
  const state =
    history.progress &&
    [
      lifecycleLabels[history.progress.lifecycleState],
      nextReview(history.progress.dueAt),
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
          <select
            aria-label="Card version"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            className="max-w-[60%] truncate rounded border border-white/20 bg-white/10 px-1 py-0.5 text-xs text-white"
          >
            <option value="current">Current version</option>
            {earlier.map((v) => (
              <option key={v.id} value={v.id}>
                {formatDay(v.startedAt)}: {v.front} →{' '}
                {v.canonicalAnswers.join(', ')}
              </option>
            ))}
            {history.unversioned && <option value={EARLIER}>{EARLIER}</option>}
          </select>
        )}
      </div>

      {!isCurrent && version && chosen !== EARLIER && (
        <div className="mt-2">
          <p className="text-white">{version.front}</p>
          <p className="text-white/60">
            Answers: {version.canonicalAnswers.join(', ')}
          </p>
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
