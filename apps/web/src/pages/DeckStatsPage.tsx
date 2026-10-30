import { useParams } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { CenteredPage } from '@/components/CenteredPage';
import { DeckHeader } from '@/components/DeckHeader';
import { StatsSkeleton } from '@/components/PageSkeleton';
import { StatCard } from '@/components/StatCard';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatPercent } from '@/lib/format';

export default function DeckStatsPage() {
  const { deckId } = useParams<{ deckId: string }>();

  const deckQuery = trpc.deck.getById.useQuery(
    { id: deckId ?? '' },
    { enabled: !!deckId },
  );
  const statsQuery = trpc.stats.deckStats.useQuery(
    { deckId: deckId ?? '' },
    { enabled: !!deckId },
  );

  const deckName = deckQuery.data?.name ?? 'Deck';
  const course = deckQuery.data?.course;
  const archivedAt = deckQuery.data?.archivedAt;

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

  if (!stats || stats.totalAttempts === 0) {
    return (
      <CenteredPage>
        <DeckHeader
          deckName={deckName}
          deckId={deckId ?? ''}
          activeTab="stats"
          course={course}
          archivedAt={archivedAt}
        />
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
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Total Attempts"
            value={String(stats.totalAttempts)}
          />
          <StatCard
            label="Cards Studied"
            value={String(stats.uniqueCardsStudied)}
          />
          <StatCard
            label="First-Try Accuracy"
            value={formatPercent(stats.firstTryAccuracy)}
          />
          <StatCard
            label="Overall Accuracy"
            value={formatPercent(stats.overallAccuracy)}
          />
        </div>

        {stats.cardStats.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold">Per-Card Breakdown</h2>
            <Table className="mt-3">
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead className="text-right">Avg. to Correct</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.cardStats.map((card) => (
                  <TableRow key={card.cardId}>
                    <TableCell className="py-4 font-medium">
                      {card.front}
                    </TableCell>
                    <TableCell className="py-4 text-right text-white/60">
                      {card.totalAttempts}
                    </TableCell>
                    <TableCell className="py-4 text-right font-medium">
                      {card.avgAttemptsToCorrect !== null
                        ? card.avgAttemptsToCorrect.toFixed(1)
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </CenteredPage>
  );
}
