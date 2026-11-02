import { Link } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { CenteredPage } from '@/components/CenteredPage';
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
import {
  directionLabels,
  type DirectedDeck,
  type StudyDirection,
} from '@/lib/directions';

/**
 * A card weak in one Study Direction: what it asks there, and, on a
 * Reversible Deck, the direction's label (ADR-0011).
 */
interface WeakCard {
  cardId: string;
  direction: StudyDirection;
  question: string;
  deck: DirectedDeck | null;
  deckId: string;
  deckName: string;
  avgAttemptsToCorrect: number;
}

function groupByDeck(cards: WeakCard[]) {
  const groups: { deckId: string; deckName: string; cards: WeakCard[] }[] = [];
  const map = new Map<string, WeakCard[]>();

  for (const card of cards) {
    const existing = map.get(card.deckId);
    if (existing) {
      existing.push(card);
    } else {
      const group: WeakCard[] = [card];
      map.set(card.deckId, group);
      groups.push({
        deckId: card.deckId,
        deckName: card.deckName,
        cards: group,
      });
    }
  }

  return groups;
}

export default function StatsPage() {
  const statsQuery = trpc.stats.overallStats.useQuery();

  if (statsQuery.isLoading) {
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

  if (!stats) {
    return null;
  }

  if (stats.totalAttempts === 0) {
    return (
      <CenteredPage centered>
        <h1 className="text-2xl font-bold text-white">Stats</h1>
        <p className="mt-2 text-white/60">
          No study data yet. Study a deck to see your stats here.
        </p>
      </CenteredPage>
    );
  }

  const deckGroups = groupByDeck(stats.weakCards);

  return (
    <CenteredPage>
      <div className="w-full max-w-2xl text-white">
        <h1 className="text-2xl font-bold">Stats</h1>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Total Attempts"
            value={String(stats.totalAttempts)}
          />
          <StatCard label="Correct" value={String(stats.totalCorrect)} />
          <StatCard
            label="Accuracy"
            value={formatPercent(stats.overallAccuracy)}
          />
          <StatCard label="Decks Studied" value={String(stats.deckCount)} />
        </div>

        {deckGroups.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold">Needs Work</h2>
            <p className="text-sm text-white/60">
              Cards that take multiple attempts to get right
            </p>
            <div className="mt-4 space-y-6">
              {deckGroups.map((group) => (
                <div key={group.deckId}>
                  <h3 className="mb-2 text-sm font-medium text-white/80">
                    <Link
                      to={`/decks/${group.deckId}`}
                      className="hover:text-white underline underline-offset-2"
                    >
                      {group.deckName}
                    </Link>
                  </h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Question</TableHead>
                        <TableHead className="text-right">
                          Avg. Attempts
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.cards.map((card) => (
                        <TableRow key={`${card.cardId}:${card.direction}`}>
                          <TableCell className="py-4 font-medium">
                            {card.question}
                            {card.deck?.reversible && (
                              <span className="ml-2 text-xs text-white/50">
                                {directionLabels(card.deck)[card.direction]}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="py-4 text-right font-medium">
                            {card.avgAttemptsToCorrect.toFixed(1)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CenteredPage>
  );
}
