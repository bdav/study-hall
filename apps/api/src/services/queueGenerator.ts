import {
  type Prisma,
  type PrismaClient,
  type SessionType,
  type StudyDirection,
  type StudyMode,
} from '@prisma/client';
import { deckOrder } from './cards.js';
import { countsSinceReset } from './countedAttempts.js';

/**
 * The cards a Study Session can draw from, by bucket, each in the order it
 * prefers them (`updated-plan.md` §13.3): due LEARNING and due REINFORCING most
 * overdue first, weak Reinforcing as §10 ranks them, and NEW in deck order (§14).
 * The buckets don't overlap: a due REINFORCING card that's weak is in weakReinforcing.
 */
export type QueueCandidates = {
  dueLearning: string[];
  dueReinforcing: string[];
  weakReinforcing: string[];
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
 * The most of a Study mode session each bucket of reviews takes before
 * others run short (§13.3). Due LEARNING may go past its 20–30% target, as
 * a card just learning is fragile, but only to half, so it can't crowd out
 * due REINFORCING (§13.4).
 */
const WEAK_CAP = 0.2;
const LEARNING_CAP = 0.5;
const DUE_REINFORCING_CAP = 0.6;

/**
 * NEW cards' share of a Study mode session (§14.1): up to a fifth
 * normally, a tenth when shaky cards (due LEARNING and weak Reinforcing) could
 * fill half of it, and never none while there are any, a trickle of one at
 * least.
 */
const NEW_SHARE = 0.2;
const NEW_SHARE_UNDER_PRESSURE = 0.1;

/** Drill Weakest's share for weak cards, the rest mostly due LEARNING (§16.2). */
const DRILL_WEAK_SHARE = 0.8;

/**
 * Cram's shares (§16.3): NEW cards 40%, within its 30–50%, and weak cards a
 * tenth, fewer than Study's, as Cram is for coverage.
 */
const CRAM_NEW_SHARE = 0.4;
const CRAM_WEAK_CAP = 0.1;

/** How many cards of each bucket a session takes. */
type Counts = {
  learning: number;
  weak: number;
  reinforcing: number;
  new: number;
};

const total = (counts: Counts) =>
  counts.learning + counts.weak + counts.reinforcing + counts.new;

/** The bucket each count draws from. */
const BUCKET_OF = {
  learning: 'dueLearning',
  weak: 'weakReinforcing',
  reinforcing: 'dueReinforcing',
  new: 'newCards',
} as const satisfies Record<keyof Counts, keyof QueueCandidates>;

/**
 * The counts with the session's room left given to the buckets in `order`,
 * each past its cap as far as its cards go.
 */
function fillRoom(
  counts: Counts,
  candidates: QueueCandidates,
  max: number,
  order: (keyof Counts)[],
) {
  const filled = { ...counts };
  for (const key of order) {
    const room = Math.max(0, max - total(filled));
    filled[key] += Math.min(
      room,
      candidates[BUCKET_OF[key]].length - filled[key],
    );
  }
  return filled;
}

/**
 * The counts with due LEARNING and then due REINFORCING given what the session
 * has room for, up to their caps.
 */
function withReviewCaps(
  counts: Counts,
  { dueLearning, dueReinforcing }: QueueCandidates,
  max: number,
) {
  const capped = { ...counts };
  capped.learning = Math.min(
    dueLearning.length,
    Math.floor(max * LEARNING_CAP),
    max - total(capped),
  );
  capped.reinforcing = Math.min(
    dueReinforcing.length,
    Math.floor(max * DUE_REINFORCING_CAP),
    max - total(capped),
  );
  return capped;
}

/** A session type's bounds on its size. */
type Size = { min: number; max: number };

/**
 * Study mode (§13.3): NEW and weak cards up to a fifth each, NEW a tenth
 * under pressure; due LEARNING up to half; due REINFORCING up to 60%. Reviews go
 * past their caps when other buckets run short; NEW cards past theirs only
 * to reach the type's minimum, as for a deck of NEW cards.
 */
function studyCounts(candidates: QueueCandidates, { min, max }: Size): Counts {
  const { dueLearning, weakReinforcing, newCards } = candidates;
  const underPressure = dueLearning.length + weakReinforcing.length >= max / 2;
  const newShare = underPressure ? NEW_SHARE_UNDER_PRESSURE : NEW_SHARE;
  const counts = withReviewCaps(
    {
      new: Math.min(newCards.length, Math.max(1, Math.floor(max * newShare))),
      weak: Math.min(weakReinforcing.length, Math.floor(max * WEAK_CAP)),
      learning: 0,
      reinforcing: 0,
    },
    candidates,
    max,
  );
  const filled = fillRoom(counts, candidates, max, [
    'learning',
    'reinforcing',
    'weak',
  ]);
  return fillRoom(filled, candidates, min, ['new']);
}

/**
 * Drill Weakest (§16.2): weak cards up to 80%, then due LEARNING, then due
 * REINFORCING only as overflow, and no NEW cards; weak cards past 80% when
 * nothing else is left.
 */
function drillCounts(candidates: QueueCandidates, { max }: Size): Counts {
  const counts = {
    weak: Math.min(
      candidates.weakReinforcing.length,
      Math.floor(max * DRILL_WEAK_SHARE),
    ),
    learning: 0,
    reinforcing: 0,
    new: 0,
  };
  return fillRoom(counts, candidates, max, ['learning', 'reinforcing', 'weak']);
}

/**
 * Cram (§16.3): NEW cards 40% and weak cards a tenth, then due LEARNING up
 * to half and due REINFORCING up to 60%. Room left goes to reviews, then to NEW
 * cards, so a deck with nothing to review is covered as fast as sessions
 * allow.
 */
function cramCounts(candidates: QueueCandidates, { max }: Size): Counts {
  const counts = withReviewCaps(
    {
      new: Math.min(
        candidates.newCards.length,
        Math.floor(max * CRAM_NEW_SHARE),
      ),
      weak: Math.min(
        candidates.weakReinforcing.length,
        Math.floor(max * CRAM_WEAK_CAP),
      ),
      learning: 0,
      reinforcing: 0,
    },
    candidates,
    max,
  );
  return fillRoom(counts, candidates, max, [
    'learning',
    'reinforcing',
    'weak',
    'new',
  ]);
}

/**
 * What each Study Mode does differently, all else, the scheduler above all,
 * being the same (§16): how it mixes a session, whether it takes weak cards
 * before they're due and NEW cards at all, and whether a card in review
 * counts as due once half its interval has passed.
 */
const MODE_RULES: Record<
  StudyMode,
  {
    counts: (candidates: QueueCandidates, size: Size) => Counts;
    weakBeforeDue: boolean;
    takesNew: boolean;
    dueAtHalfInterval: boolean;
  }
> = {
  STUDY: {
    counts: studyCounts,
    weakBeforeDue: false,
    takesNew: true,
    dueAtHalfInterval: false,
  },
  DRILL_WEAKEST: {
    counts: drillCounts,
    weakBeforeDue: true,
    takesNew: false,
    dueAtHalfInterval: false,
  },
  CRAM: {
    counts: cramCounts,
    weakBeforeDue: false,
    takesNew: true,
    dueAtHalfInterval: true,
  },
};

/**
 * A Study Session's queue of card ids (§13, §16): the most cards its type
 * allows, drawn from the buckets by its Study Mode's shares and caps.
 * However large a due backlog, the session is no bigger; the backlog only
 * decides which cards come. The reviews are shuffled by `seed`, so one seed
 * always gives one queue, and the NEW cards, in deck order, are spread
 * evenly through them (§14.2).
 */
export function composeQueue({
  candidates,
  sessionType,
  studyMode = 'STUDY',
  seed,
}: {
  candidates: QueueCandidates;
  sessionType: SessionType;
  studyMode?: StudyMode;
  seed: number;
}): string[] {
  const counts = MODE_RULES[studyMode].counts(
    candidates,
    SESSION_SIZES[sessionType],
  );
  const reviews = shuffle(
    [
      ...candidates.dueLearning.slice(0, counts.learning),
      ...candidates.weakReinforcing.slice(0, counts.weak),
      ...candidates.dueReinforcing.slice(0, counts.reinforcing),
    ],
    seed,
  );
  return spreadThrough(reviews, candidates.newCards.slice(0, counts.new));
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

/** A REINFORCING card with this mastery or less is weak (§10). */
const WEAK_MASTERY = 3;
/** Or one missed this often in its last RECENT_ANSWERS answers. */
const WEAK_MISSES = 2;
const RECENT_ANSWERS = 5;

/**
 * How many LEARNING and REINFORCING cards, soonest due first, are considered: a
 * bound on what a backlog makes each preview and start read (§13.1), and
 * well past what the biggest session takes.
 */
const CANDIDATE_POOL = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

const progressFields = {
  cardId: true,
  lifecycleState: true,
  masteryScore: true,
  dueAt: true,
  lastIntervalDays: true,
  lastReviewedAt: true,
  markedKnownAt: true,
  resetAt: true,
} as const;

type Progress = Prisma.CardProgressGetPayload<{
  select: typeof progressFields;
}>;

/**
 * Whether a card in review is due for a session in a Study Mode: its due
 * time has come, or, in Cram, half its interval has passed (§16.3: the
 * earlier of its due time and Cram's; the date-driven pacing is to come).
 */
function isDue(
  { dueAt, lastIntervalDays }: Progress,
  studyMode: StudyMode,
  now: Date,
) {
  if (!dueAt) return false;
  if (dueAt <= now) return true;
  if (!MODE_RULES[studyMode].dueAtHalfInterval || lastIntervalDays === null) {
    return false;
  }
  return dueAt.getTime() - (lastIntervalDays * DAY_MS) / 2 <= now.getTime();
}

/**
 * Whether a REINFORCING card is weak (§10): mastery 3 or less, or 2 misses in
 * its last 5 answers. A card marked known since it was last answered isn't,
 * though marking it known sets its mastery to 3: the learner says they know
 * it, until an answer says otherwise (ADR-0009).
 */
function isWeak(card: Progress, misses: number) {
  const markedKnownSinceAnswered =
    card.markedKnownAt !== null &&
    (card.lastReviewedAt === null || card.markedKnownAt > card.lastReviewedAt);
  return (
    !markedKnownSinceAnswered &&
    (card.masteryScore <= WEAK_MASTERY || misses >= WEAK_MISSES)
  );
}

/**
 * The cards a learner's Study Session on a deck can draw from now in a
 * Study Mode and Study Direction, by their progress in that direction, by
 * bucket, each as long as the biggest session could use. Weakness
 * is derived, never stored (§10), from answers since the card's progress
 * last reset, Retries left out as they don't count toward it. Study and
 * Cram take a weak card once it's due; Drill Weakest takes it before (§16.2)
 * and takes no NEW cards. Only the CANDIDATE_POOL soonest due cards in
 * review, and in Drill Weakest as many with the lowest mastery, are
 * considered. Cards due at the same moment, as cards marked known together
 * are, go in a fixed order, so a seed always gives one queue.
 */
export async function findQueueCandidates(
  prisma: PrismaClient,
  {
    userId,
    deckId,
    direction,
  }: { userId: string; deckId: string; direction: StudyDirection },
  {
    studyMode = 'STUDY',
    now = new Date(),
  }: { studyMode?: StudyMode; now?: Date } = {},
): Promise<QueueCandidates> {
  const most = Math.max(...Object.values(SESSION_SIZES).map(({ max }) => max));
  const { weakBeforeDue, takesNew } = MODE_RULES[studyMode];
  const [inReview, lowMastery, newCards] = await Promise.all([
    prisma.cardProgress.findMany({
      where: {
        userId,
        deckId,
        direction,
        lifecycleState: { in: ['LEARNING', 'REINFORCING'] },
        dueAt: { not: null },
      },
      orderBy: [{ dueAt: 'asc' }, { cardId: 'asc' }],
      select: progressFields,
      take: CANDIDATE_POOL,
    }),
    // Weak cards taken before they're due may be far from it
    weakBeforeDue
      ? prisma.cardProgress.findMany({
          where: {
            userId,
            deckId,
            direction,
            lifecycleState: 'REINFORCING',
            masteryScore: { lte: WEAK_MASTERY },
          },
          orderBy: [{ masteryScore: 'asc' }, { cardId: 'asc' }],
          select: progressFields,
          take: CANDIDATE_POOL,
        })
      : [],
    takesNew
      ? prisma.cardProgress.findMany({
          where: { userId, deckId, direction, lifecycleState: 'NEW' },
          orderBy: deckOrder.map((order) => ({ card: order })),
          select: { cardId: true },
          take: most,
        })
      : [],
  ]);

  const reinforcing = new Map(
    [...inReview, ...lowMastery]
      .filter((card) => card.lifecycleState === 'REINFORCING')
      .map((card) => [card.cardId, card]),
  );
  const misses = await recentMisses(prisma, userId, direction, [
    ...reinforcing.values(),
  ]);
  const weak = [...reinforcing.values()]
    .map((card) => ({ card, misses: misses.get(card.cardId) ?? 0 }))
    .filter(
      ({ card, misses }) =>
        isWeak(card, misses) && (weakBeforeDue || isDue(card, studyMode, now)),
    )
    // Ranked by recent misses, then mastery, then how overdue (§10)
    .sort(
      (a, b) =>
        b.misses - a.misses ||
        a.card.masteryScore - b.card.masteryScore ||
        a.card.dueAt!.getTime() - b.card.dueAt!.getTime(),
    )
    .map(({ card }) => card.cardId);
  const weakIds = new Set(weak);

  const due = inReview.filter((card) => isDue(card, studyMode, now));
  return {
    dueLearning: due
      .filter((card) => card.lifecycleState === 'LEARNING')
      .slice(0, most)
      .map((card) => card.cardId),
    dueReinforcing: due
      .filter(
        (card) =>
          card.lifecycleState === 'REINFORCING' && !weakIds.has(card.cardId),
      )
      .slice(0, most)
      .map((card) => card.cardId),
    weakReinforcing: weak.slice(0, most),
    newCards: newCards.map((card) => card.cardId),
  };
}

/**
 * How many of each card's last RECENT_ANSWERS counted answers in a Study
 * Direction were missed: those since its progress last reset, Retries left
 * out.
 */
async function recentMisses(
  prisma: PrismaClient,
  userId: string,
  direction: StudyDirection,
  cards: { cardId: string; resetAt: Date }[],
) {
  const attempts = await prisma.cardAttempt.findMany({
    where: {
      cardId: { in: cards.map((card) => card.cardId) },
      direction,
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
