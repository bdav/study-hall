import {
  type CardLifecycleState,
  type Prisma,
  type PrismaClient,
  type StudyDirection,
  type StudyMode,
} from '@prisma/client';
import { countsSinceReset } from './countedAttempts.js';
import { isKnown, masteryBand, type MasteryBand } from './progressUpdater.js';

/**
 * Where one Study Direction of a learner's card stands (GLOSSARY.md, Card
 * Standing): its Lifecycle State, mastery band, whether it's Due and Weak,
 * and its recent misses. Its mastery score stays on the server, never shown
 * to the learner.
 */
export type CardStanding = {
  cardId: string;
  deckId: string;
  direction: StudyDirection;
  lifecycleState: CardLifecycleState;
  masteryBand: MasteryBand;
  /** Known already, so marking it known would leave it as it is (ADR-0009). */
  isKnown: boolean;
  isDue: boolean;
  isWeak: boolean;
  /** How many of its last 5 Counted Answers were missed. */
  recentMisses: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** A REINFORCING card with this mastery or less is Weak (§10). */
const WEAK_MASTERY = 3;
/** Or one missed this often in its last RECENT_ANSWERS Counted Answers. */
const WEAK_MISSES = 2;
const RECENT_ANSWERS = 5;

const progressFields = {
  cardId: true,
  deckId: true,
  direction: true,
  lifecycleState: true,
  masteryScore: true,
  dueAt: true,
  lastIntervalDays: true,
  lastReviewedAt: true,
  markedKnownAt: true,
  resetAt: true,
} as const;

/** The progress a card's standing is read from. */
type Progress = Prisma.CardProgressGetPayload<{
  select: typeof progressFields;
}>;

/**
 * When a card in review comes due for a session in a Study Mode: at its due
 * time, or, in Cram, once half its interval has passed (§16.3: the earlier
 * of its due time and Cram's). Null for a card not in review.
 */
function dueFrom(
  { lifecycleState, dueAt, lastIntervalDays }: Progress,
  studyMode: StudyMode,
) {
  if (lifecycleState !== 'LEARNING' && lifecycleState !== 'REINFORCING') {
    return null;
  }
  if (!dueAt) return null;
  if (studyMode !== 'CRAM' || lastIntervalDays === null) return dueAt;
  return new Date(dueAt.getTime() - (lastIntervalDays * DAY_MS) / 2);
}

/**
 * Whether the learner has marked a card known since they last answered it:
 * they say they know it, until an answer says otherwise (ADR-0009).
 */
function markedKnownSinceAnswered({ markedKnownAt, lastReviewedAt }: Progress) {
  return (
    markedKnownAt !== null &&
    (lastReviewedAt === null || markedKnownAt > lastReviewedAt)
  );
}

/**
 * Whether a card is Weak (§10): REINFORCING, with mastery 3 or less or 2
 * misses in its last 5 Counted Answers, and not Marked Known since it was
 * last answered. That last is a rule of its own, though marking it known
 * leaves mastery at 3 or more.
 */
function isWeak(card: Progress, misses: number) {
  return (
    card.lifecycleState === 'REINFORCING' &&
    !markedKnownSinceAnswered(card) &&
    (card.masteryScore <= WEAK_MASTERY || misses >= WEAK_MISSES)
  );
}

/**
 * The standing of every card in a learner's decks, in one Study Direction
 * or, when none is given, both, for a Study Mode (Study unless given): the
 * decks in the order given, each in deck order, a card's Forward before its
 * Reverse.
 */
export async function readCardStanding(
  prisma: PrismaClient,
  {
    userId,
    deckIds,
    direction,
    studyMode = 'STUDY',
    now = new Date(),
  }: {
    userId: string;
    deckIds: string[];
    direction?: StudyDirection;
    studyMode?: StudyMode;
    now?: Date;
  },
) {
  const progress = await prisma.cardProgress.findMany({
    where: {
      userId,
      deckId: { in: deckIds },
      ...(direction && { direction }),
      // Reverse has none while its deck isn't reversible (ADR-0011)
      OR: [{ direction: 'FORWARD' }, { card: { deck: { reversible: true } } }],
    },
    orderBy: [
      { card: { position: 'asc' } },
      { card: { createdAt: 'asc' } },
      { direction: 'asc' },
    ],
    select: progressFields,
  });
  // The decks in the order asked, each in deck order (a stable sort)
  const deckPosition = new Map(deckIds.map((id, i) => [id, i]));
  progress.sort(
    (a, b) => deckPosition.get(a.deckId)! - deckPosition.get(b.deckId)!,
  );
  const misses = await recentMisses(prisma, userId, progress);

  const read = progress.map((card) => {
    const due = dueFrom(card, studyMode);
    const cardMisses = misses.get(key(card)) ?? 0;
    const standing: CardStanding = {
      cardId: card.cardId,
      deckId: card.deckId,
      direction: card.direction,
      lifecycleState: card.lifecycleState,
      masteryBand: masteryBand(card.masteryScore),
      isKnown: isKnown(card.lifecycleState),
      isDue: due !== null && due <= now,
      isWeak: isWeak(card, cardMisses),
      recentMisses: cardMisses,
    };
    return { standing, progress: card, due };
  });
  // When the next card not yet due comes due in the Study Mode
  const nextDueAt = read.reduce<Date | null>(
    (next, { due }) => (due && due > now && (!next || due < next) ? due : next),
    null,
  );

  const cards = read.map(({ standing }) => standing);
  return {
    cards,
    due: read
      .filter(({ standing }) => standing.isDue)
      .sort((a, b) => byDueTime(a.progress, b.progress))
      .map(({ standing }) => standing),
    // Ranked by recent misses, then mastery, then how overdue (§10, §13)
    weak: read
      .filter(({ standing }) => standing.isWeak)
      .sort(
        (a, b) =>
          b.standing.recentMisses - a.standing.recentMisses ||
          a.progress.masteryScore - b.progress.masteryScore ||
          byDueTime(a.progress, b.progress),
      )
      .map(({ standing }) => standing),
    counts: {
      due: cards.filter((card) => card.isDue).length,
      new: cards.filter((card) => card.lifecycleState === 'NEW').length,
    },
    nextDueAt,
  };
}

/**
 * Soonest due first, and cards due at the same moment, as cards marked
 * known together are, in a fixed order.
 */
function byDueTime(a: Progress, b: Progress) {
  return (
    (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) ||
    compare(a.cardId, b.cardId) ||
    compare(a.direction, b.direction)
  );
}

/** Two strings' order by their code units, the same in every locale. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One Study Direction of a card, as a map key. */
const key = ({
  cardId,
  direction,
}: {
  cardId: string;
  direction: StudyDirection;
}) => `${cardId}:${direction}`;

/**
 * How many of each card's last RECENT_ANSWERS Counted Answers in each Study
 * Direction were missed: answers since its progress there last reset
 * (ADR-0004), Retries left out. A card not in review has none: a NEW one
 * has had no answer since, and a RETIRED one isn't scheduled.
 */
async function recentMisses(
  prisma: PrismaClient,
  userId: string,
  progress: Progress[],
) {
  const cards = progress.filter(
    ({ lifecycleState }) =>
      lifecycleState === 'LEARNING' || lifecycleState === 'REINFORCING',
  );
  const attempts = await prisma.cardAttempt.findMany({
    where: {
      cardId: { in: [...new Set(cards.map((card) => card.cardId))] },
      studySession: { userId },
      isRetry: false,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      cardId: true,
      direction: true,
      recallGrade: true,
      createdAt: true,
    },
  });
  const resetAt = new Map(cards.map((card) => [key(card), card.resetAt]));
  const seen = new Map<string, number>();
  const misses = new Map<string, number>();
  for (const attempt of attempts) {
    const reset = resetAt.get(key(attempt));
    if (!reset || !countsSinceReset(attempt.createdAt, reset)) continue;
    const answered = seen.get(key(attempt)) ?? 0;
    if (answered >= RECENT_ANSWERS) continue;
    seen.set(key(attempt), answered + 1);
    if (attempt.recallGrade === 'MISSED') {
      misses.set(key(attempt), (misses.get(key(attempt)) ?? 0) + 1);
    }
  }
  return misses;
}

/** The standing of a learner's cards, as `readCardStanding` reads it. */
export type Standings = Awaited<ReturnType<typeof readCardStanding>>;
