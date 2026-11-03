import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { CenteredPage } from '@/components/CenteredPage';
import { DeckHeader } from '@/components/DeckHeader';
import { StatsSkeleton } from '@/components/PageSkeleton';
import { StatCard } from '@/components/StatCard';
import {
  BandCounts,
  EmptySection,
  GradeCounts,
  LifecycleCounts,
  RecentSessions,
  StatsSection,
  WeakestOf,
} from '@/components/StatsSections';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatPercent } from '@/lib/format';
import { directionLabels, type StudyDirection } from '@/lib/directions';
import { DirectionPicker } from '@/components/DirectionPicker';

/**
 * A deck's stats on the scheduler's terms, on a Reversible Deck in the
 * Study Direction chosen, each counted on its own (ADR-0011), Forward to
 * start: its Counted Answers by Recall Grade and their accuracy, its cards
 * by Lifecycle State and Mastery Band, its weakest cards and its recent
 * Study Sessions.
 */
export default function DeckStatsPage() {
  const { deckId } = useParams<{ deckId: string }>();
  const [chosenDirection, setDirection] = useState<StudyDirection>('FORWARD');

  const deckQuery = trpc.deck.getById.useQuery(
    { id: deckId ?? '' },
    { enabled: !!deckId },
  );
  const deck = deckQuery.data;
  const isReversible = !!deck?.reversible;
  const direction = isReversible ? chosenDirection : 'FORWARD';
  const statsQuery = trpc.stats.deckStats.useQuery(
    { deckId: deckId ?? '', direction },
    { enabled: !!deckId },
  );

  const deckName = deck?.name ?? 'Deck';
  const course = deck?.course;
  const archivedAt = deck?.archivedAt;
  const directionChoice = deck && isReversible && (
    <DirectionPicker
      labels={directionLabels(deck)}
      value={direction}
      onChange={setDirection}
      className="mt-4"
    />
  );

  if (statsQuery.isLoading || deckQuery.isLoading) {
    return <StatsSkeleton />;
  }

  if (statsQuery.isError) {
    return (
      <CenteredPage centered>
        <p className="text-destructive">Error loading stats.</p>
      </CenteredPage>
    );
  }

  const stats = statsQuery.data;

  if (!stats || (stats.answerCount === 0 && stats.sessions.length === 0)) {
    return (
      <CenteredPage>
        <DeckHeader
          deckName={deckName}
          deckId={deckId ?? ''}
          activeTab="stats"
          course={course}
          archivedAt={archivedAt}
        />
        {directionChoice}
        <p className="mt-6 text-center text-white/60">
          No study data yet. Study this deck to see stats here.
        </p>
      </CenteredPage>
    );
  }

  return (
    <CenteredPage>
      <DeckHeader
        deckName={deckName}
        deckId={deckId ?? ''}
        activeTab="stats"
        course={course}
        archivedAt={archivedAt}
      />
      <div className="w-full max-w-4xl text-white">
        {directionChoice}
        <div className="mt-6 grid grid-cols-2 gap-4">
          <StatCard label="Answers" value={String(stats.answerCount)} />
          <StatCard label="Accuracy" value={formatPercent(stats.accuracy)} />
        </div>

        <GradeCounts answers={stats.answers} />
        <LifecycleCounts lifecycle={stats.lifecycle} />
        <BandCounts bands={stats.bands} />

        <StatsSection title="Weak cards">
          <WeakestOf
            shown={stats.weakCards.length}
            weakCount={stats.weakCount}
          />
          {stats.weakCards.length === 0 ? (
            <EmptySection>No weak cards right now.</EmptySection>
          ) : (
            <Table className="mt-3">
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead className="text-right">Recent misses</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.weakCards.map((card) => (
                  <TableRow key={card.cardId}>
                    <TableCell className="py-4 font-medium">
                      {card.question}
                    </TableCell>
                    <TableCell className="py-4 text-right">
                      {card.recentMisses}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </StatsSection>

        <RecentSessions sessions={stats.sessions} />
      </div>
    </CenteredPage>
  );
}
