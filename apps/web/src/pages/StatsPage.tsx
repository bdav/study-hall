import { Link } from 'react-router-dom';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { trpc } from '@/lib/trpc';
import { CenteredPage } from '@/components/CenteredPage';
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
import { directionLabels } from '@/lib/directions';

type WeakCard =
  inferRouterOutputs<AppRouter>['stats']['overallStats']['weakCards'][number];

/** Weak cards grouped by deck, the decks in the order their cards rank. */
function groupByDeck(cards: WeakCard[]) {
  const groups = new Map<
    string,
    { deck: WeakCard['deck']; cards: WeakCard[] }
  >();
  for (const card of cards) {
    const group = groups.get(card.deck.id) ?? { deck: card.deck, cards: [] };
    group.cards.push(card);
    groups.set(card.deck.id, group);
  }
  return [...groups.values()];
}

/**
 * The learner's stats on the scheduler's terms, across their decks in
 * Flashcards, as a deck's stats page shows its own: Counted Answers by
 * Recall Grade and their accuracy, cards by Lifecycle State and Mastery
 * Band, the weakest cards by deck, and recent Study Sessions, each naming
 * its deck and its course, if any.
 */
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

  if (stats.answerCount === 0 && stats.sessions.length === 0) {
    return (
      <CenteredPage centered>
        <h1 className="text-2xl font-bold text-white">Stats</h1>
        <p className="mt-2 text-white/60">
          No study data yet. Study a deck to see your stats here.
        </p>
      </CenteredPage>
    );
  }

  return (
    <CenteredPage>
      <div className="w-full max-w-2xl text-white">
        <h1 className="text-2xl font-bold">Stats</h1>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <StatCard label="Answers" value={String(stats.answerCount)} />
          <StatCard label="Accuracy" value={formatPercent(stats.accuracy)} />
          <StatCard label="Decks studied" value={String(stats.deckCount)} />
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
            <div className="mt-4 space-y-6">
              {groupByDeck(stats.weakCards).map(({ deck, cards }) => (
                <div key={deck.id}>
                  <h3 className="mb-2 text-sm font-medium text-white/80">
                    <Link
                      to={`/decks/${deck.id}`}
                      className="touch-target underline underline-offset-2 hover:text-white"
                    >
                      {deck.name}
                    </Link>
                    {deck.course && (
                      <span className="ml-2 text-white/50">
                        {deck.course.title}
                      </span>
                    )}
                  </h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Question</TableHead>
                        <TableHead className="text-right">
                          Recent misses
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cards.map((card) => (
                        <TableRow key={`${card.cardId}:${card.direction}`}>
                          <TableCell className="py-4 font-medium">
                            {card.question}
                            {card.deck.reversible && (
                              <span className="ml-2 text-xs text-white/50">
                                {directionLabels(card.deck)[card.direction]}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="py-4 text-right">
                            {card.recentMisses}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </StatsSection>

        <RecentSessions sessions={stats.sessions} showDeck />
      </div>
    </CenteredPage>
  );
}
