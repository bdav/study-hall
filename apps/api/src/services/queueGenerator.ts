import { type PrismaClient, type SessionType } from '@prisma/client';
import { deckOrder } from './cards.js';
import { countsSinceReset } from './countedAttempts.js';

/**
 * The cards a Study Session can draw from, by bucket, each in the order it
 * prefers them (`updated-plan.md` §13.3): due LEARNING and due STABLE most
 * overdue first, weak STABLE as §10 ranks them, and NEW in deck order (§14).
 * The buckets don't overlap: a due STABLE card that's weak is in weakStable.
 */
export type QueueCandidates = {
  dueLearning: string[];
  dueStable: string[];
  weakStable: string[];
  newCards: string[];
};

/** Each session type's bounds on its size in cards (§12.1). */
export const SESSION_SIZES: Record<SessionType, { min: number; max: number }> =
  {
    QUICK: { min: 5, max: 12 },
    STANDARD: { min: 10, max: 25 },
    DEEP: { min: 20, max: 50 },
  };

/**
 * The most of a session each bucket of reviews takes before others run
 * short (§13.3). Due LEARNING may go past its 20–30% target, as early
 * stabilization is fragile, but only to half, so it can't crowd out due
 * STABLE (§13.4).
 */
const WEAK_CAP = 0.2;
const LEARNING_CAP = 0.5;
const DUE_STABLE_CAP = 0.6;

/**
 * NEW cards' share of a session (§14.1): up to a fifth normally, a tenth
 * when shaky cards (due LEARNING and weak STABLE) could fill half of it,
 * and never none while there are any, a trickle of one at least.
 */
const NEW_SHARE = 0.2;
const NEW_SHARE_UNDER_PRESSURE = 0.1;

/**
 * A Study Session's queue of card ids (§13): the most cards its type
 * allows, drawn from the buckets by their shares and caps. Reviews go over
 * their caps when other buckets run short; NEW cards go over theirs only
 * to reach the type's minimum size, as for a deck of NEW cards. However
 * large a due backlog, the session is no bigger; the backlog only decides
 * which cards come. The reviews are shuffled by `seed`, so one seed always
 * gives one queue, and the NEW cards, in deck order, are spread evenly
 * through them (§14.2).
 */
export function composeQueue({
  candidates,
  sessionType,
  seed,
}: {
  candidates: QueueCandidates;
  sessionType: SessionType;
  seed: number;
}): string[] {
  const { min, max } = SESSION_SIZES[sessionType];
  const { dueLearning, dueStable, weakStable, newCards } = candidates;

  const underPressure = dueLearning.length + weakStable.length >= max / 2;
  const newShare = underPressure ? NEW_SHARE_UNDER_PRESSURE : NEW_SHARE;
  let newCount = Math.min(
    newCards.length,
    Math.max(1, Math.floor(max * newShare)),
  );
  let weakCount = Math.min(weakStable.length, Math.floor(max * WEAK_CAP));
  let learningCount = Math.min(
    dueLearning.length,
    Math.floor(max * LEARNING_CAP),
    max - newCount - weakCount,
  );
  let stableCount = Math.min(
    dueStable.length,
    Math.floor(max * DUE_STABLE_CAP),
    max - newCount - weakCount - learningCount,
  );

  // Room left goes to reviews past their caps, most urgent first
  let room = max - newCount - weakCount - learningCount - stableCount;
  const moreLearning = Math.min(room, dueLearning.length - learningCount);
  learningCount += moreLearning;
  room -= moreLearning;
  const moreStable = Math.min(room, dueStable.length - stableCount);
  stableCount += moreStable;
  room -= moreStable;
  const moreWeak = Math.min(room, weakStable.length - weakCount);
  weakCount += moreWeak;

  // NEW cards past their cap only to reach the minimum
  const total = newCount + weakCount + learningCount + stableCount;
  if (total < min) {
    newCount = Math.min(newCards.length, newCount + (min - total));
  }

  const reviews = shuffle(
    [
      ...dueLearning.slice(0, learningCount),
      ...weakStable.slice(0, weakCount),
      ...dueStable.slice(0, stableCount),
    ],
    seed,
  );
  return spreadThrough(reviews, newCards.slice(0, newCount));
}

/**
 * `extra` spread evenly through `base`, in order: with n cards in all, the
 * i-th of k goes at about (i + 1) · n / (k + 1), so none come first and
 * none bunch together.
 */
function spreadThrough(base: string[], extra: string[]) {
  const n = base.length + extra.length;
  const at = new Set(
    extra.map((_, i) => Math.floor(((i + 1) * n) / (extra.length + 1))),
  );
  const queue: string[] = [];
  let b = 0;
  let e = 0;
  for (let position = 0; position < n; position++) {
    queue.push(at.has(position) ? extra[e++] : base[b++]);
  }
  return queue;
}

/** A copy of `items` in an order fixed by `seed` (Fisher–Yates). */
function shuffle<T>(items: T[], seed: number) {
  const random = mulberry32(seed);
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** A small seeded random number generator, giving numbers in [0, 1). */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A STABLE card with this mastery or less is weak (§10). */
const WEAK_MASTERY = 3;
/** Or one missed this often in its last RECENT_ANSWERS answers. */
const WEAK_MISSES = 2;
const RECENT_ANSWERS = 5;

/**
 * How many of the most overdue STABLE cards are checked for weakness: a
 * bound on what a backlog makes each preview and start read (§13.1), and
 * well past what the biggest session takes.
 */
const STABLE_POOL = 200;

/**
 * The cards a learner's Study Session on a deck can draw from now, by
 * bucket, each as long as the biggest session could use. Weakness is
 * derived, never stored (§10): a due STABLE card is weak with mastery 3 or
 * less, or 2 misses in its last 5 answers since its progress last reset,
 * Retries left out as they don't count toward it. Only due cards come, so a
 * weak card waits for its due date, and only the STABLE_POOL most overdue
 * are checked. Cards due at the same moment, as cards marked known
 * together are, go in a fixed order, so a seed always gives one queue.
 */
export async function findQueueCandidates(
  prisma: PrismaClient,
  { userId, deckId }: { userId: string; deckId: string },
  now = new Date(),
): Promise<QueueCandidates> {
  const most = Math.max(...Object.values(SESSION_SIZES).map(({ max }) => max));
  const [dueLearning, dueStable, newCards] = await Promise.all([
    prisma.cardProgress.findMany({
      where: {
        userId,
        deckId,
        lifecycleState: 'LEARNING',
        dueAt: { lte: now },
      },
      orderBy: [{ dueAt: 'asc' }, { cardId: 'asc' }],
      select: { cardId: true },
      take: most,
    }),
    prisma.cardProgress.findMany({
      where: { userId, deckId, lifecycleState: 'STABLE', dueAt: { lte: now } },
      orderBy: [{ dueAt: 'asc' }, { cardId: 'asc' }],
      select: { cardId: true, masteryScore: true, resetAt: true, dueAt: true },
      take: STABLE_POOL,
    }),
    prisma.cardProgress.findMany({
      where: { userId, deckId, lifecycleState: 'NEW' },
      orderBy: deckOrder.map((order) => ({ card: order })),
      select: { cardId: true },
      take: most,
    }),
  ]);

  const misses = await recentMisses(prisma, userId, dueStable);
  const withMisses = dueStable.map((progress) => ({
    ...progress,
    misses: misses.get(progress.cardId) ?? 0,
  }));
  const isWeak = (card: { masteryScore: number; misses: number }) =>
    card.masteryScore <= WEAK_MASTERY || card.misses >= WEAK_MISSES;
  // Ranked by recent misses, then mastery, then how overdue (§10)
  const weak = withMisses
    .filter(isWeak)
    .sort(
      (a, b) =>
        b.misses - a.misses ||
        a.masteryScore - b.masteryScore ||
        a.dueAt!.getTime() - b.dueAt!.getTime(),
    );

  return {
    dueLearning: dueLearning.map((p) => p.cardId),
    dueStable: withMisses
      .filter((card) => !isWeak(card))
      .slice(0, most)
      .map((p) => p.cardId),
    weakStable: weak.slice(0, most).map((p) => p.cardId),
    newCards: newCards.map((p) => p.cardId),
  };
}

/**
 * How many of each card's last RECENT_ANSWERS counted answers were
 * missed: those since its progress last reset, Retries left out.
 */
async function recentMisses(
  prisma: PrismaClient,
  userId: string,
  cards: { cardId: string; resetAt: Date }[],
) {
  const attempts = await prisma.cardAttempt.findMany({
    where: {
      cardId: { in: cards.map((card) => card.cardId) },
      studySession: { userId },
      isRetry: false,
    },
    orderBy: { createdAt: 'desc' },
    select: { cardId: true, recallGrade: true, createdAt: true },
  });
  const resetAt = new Map(cards.map((card) => [card.cardId, card.resetAt]));
  const recent = new Map<string, number>();
  const misses = new Map<string, number>();
  for (const attempt of attempts) {
    if (!countsSinceReset(attempt.createdAt, resetAt.get(attempt.cardId)!)) {
      continue;
    }
    const seen = recent.get(attempt.cardId) ?? 0;
    if (seen >= RECENT_ANSWERS) continue;
    recent.set(attempt.cardId, seen + 1);
    if (attempt.recallGrade === 'MISSED') {
      misses.set(attempt.cardId, (misses.get(attempt.cardId) ?? 0) + 1);
    }
  }
  return misses;
}
