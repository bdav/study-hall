import { useId, type ReactNode } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { StatCard } from '@/components/StatCard';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import {
  LIFECYCLE_STATES,
  lifecycleLabels,
  MASTERY_BANDS,
  masteryBandLabels,
} from '@/lib/lifecycle';
import { recallGradeLabels } from '@/lib/recallGrades';
import { SESSION_TYPES, STUDY_MODES } from '@/lib/sessionChoices';

type Stats = inferRouterOutputs<AppRouter>['stats'];
type StandingStats = Pick<
  Stats['deckStats'],
  'answers' | 'lifecycle' | 'bands' | 'weakCount'
>;
type Session = Stats['overallStats']['sessions'][number];

/** A stats page's section: a heading, and what it shows below. */
export function StatsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Counts as tiles, each its number above what it counts. */
export function CountTiles({
  counts,
}: {
  counts: { label: string; count: number }[];
}) {
  return (
    <ul className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {counts.map(({ label, count }) => (
        <li key={label}>
          <StatCard label={label} value={String(count)} />
        </li>
      ))}
    </ul>
  );
}

/** What a stats page says when a section has nothing to show. */
export function EmptySection({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm text-white/60">{children}</p>;
}

/**
 * Counted Answers by Recall Grade, in the API's order, Missed first;
 * Partially correct only once there are some, as nothing grades an answer
 * so yet.
 */
export function GradeCounts({ answers }: Pick<StandingStats, 'answers'>) {
  const grades = Object.keys(answers) as (keyof typeof answers)[];
  return (
    <StatsSection title="Answers by grade">
      <CountTiles
        counts={grades
          .filter(
            (grade) => grade !== 'PARTIALLY_CORRECT' || answers[grade] > 0,
          )
          .map((grade) => ({
            label: recallGradeLabels[grade],
            count: answers[grade],
          }))}
      />
    </StatsSection>
  );
}

/** How many cards are in each Lifecycle State. */
export function LifecycleCounts({
  lifecycle,
}: Pick<StandingStats, 'lifecycle'>) {
  return (
    <StatsSection title="Cards">
      <CountTiles
        counts={LIFECYCLE_STATES.map((state) => ({
          label: lifecycleLabels[state],
          count: lifecycle[state],
        }))}
      />
    </StatsSection>
  );
}

/**
 * How many answered cards are in each Mastery Band, never a card's own
 * mastery; that none are yet, before any is answered.
 */
export function BandCounts({ bands }: Pick<StandingStats, 'bands'>) {
  const answered = MASTERY_BANDS.reduce((sum, band) => sum + bands[band], 0);
  return (
    <StatsSection title="Mastery">
      {answered === 0 ? (
        <EmptySection>No cards answered yet.</EmptySection>
      ) : (
        <CountTiles
          counts={MASTERY_BANDS.map((band) => ({
            label: masteryBandLabels[band],
            count: bands[band],
          }))}
        />
      )}
    </StatsSection>
  );
}

/** That only the weakest are listed, when there are more Weak cards. */
export function WeakestOf({
  shown,
  weakCount,
}: { shown: number } & Pick<StandingStats, 'weakCount'>) {
  if (weakCount <= shown) return null;
  return (
    <p className="mt-1 text-sm text-white/60">
      The weakest {shown} of {weakCount}
    </p>
  );
}

const sessionStatusLabels: Record<Session['status'], string> = {
  ACTIVE: 'In progress',
  COMPLETED: 'Finished',
  ABANDONED: 'Abandoned',
};

const labelOf = <T extends string>(
  choices: readonly { value: T; label: string }[],
  value: T,
) => choices.find((choice) => choice.value === value)?.label ?? value;

/** A session's deck, and its course when it has one. */
function deckLine({ name, course }: Session['deck']) {
  return course ? `${name} · ${course.title}` : name;
}

/**
 * The latest finished or abandoned Study Sessions: when, their type and
 * Study Mode, how many cards they answered and got right, and how they
 * ended; and their deck, when `showDeck`.
 */
export function RecentSessions({
  sessions,
  showDeck = false,
}: {
  sessions: Session[];
  showDeck?: boolean;
}) {
  return (
    <StatsSection title="Recent sessions">
      {sessions.length === 0 ? (
        <EmptySection>No finished sessions yet.</EmptySection>
      ) : (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              {showDeck && <TableHead>Deck</TableHead>}
              <TableHead>Type</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Answered</TableHead>
              <TableHead className="text-right">Right</TableHead>
              <TableHead>Ended</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell>{formatDate(session.startedAt)}</TableCell>
                {showDeck && <TableCell>{deckLine(session.deck)}</TableCell>}
                <TableCell>
                  {labelOf(SESSION_TYPES, session.sessionType)}
                </TableCell>
                <TableCell>{labelOf(STUDY_MODES, session.studyMode)}</TableCell>
                <TableCell className="text-right">{session.answered}</TableCell>
                <TableCell className="text-right">{session.right}</TableCell>
                <TableCell>{sessionStatusLabels[session.status]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </StatsSection>
  );
}
