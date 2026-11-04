import {
  CardLifecycleState,
  type Prisma,
  type PrismaClient,
  type RecallGrade,
  type StudyDirection,
  type StudyMode,
} from '@prisma/client';
import { countsSinceReset, isCorrect } from './countedAttempts.js';
import {
  applyAnswer,
  isKnown,
  isRetirable,
  type LifecycleMark,
  markKnown,
  MASTERY_BANDS,
  masteryBand,
  type MasteryBand,
  NEW_PROGRESS,
  replayAnswers,
  retire,
  type ScheduledAnswer,
  unretire,
} from './progressUpdater.js';

/**
 * Where one Study Direction of a learner's card stands (GLOSSARY.md, Card
 * Standing): its Lifecycle State, Mastery Band, whether it's Due and when,
 * whether it's Weak, and its recent misses. Its mastery score stays on the
 * server, never shown to the learner.
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
  /**
   * When it next comes due in the Study Mode (`dueFrom`); none for a card
   * not in review.
   */
  dueAt: Date | null;
  isWeak: boolean;
  /**
   * Whether the app suggests retiring it in this direction (#86): mastered,
   * its latest Counted Answer Nailed (`isRetirable`).
   */
  isRetirable: boolean;
  /** How many of its last 5 Counted Answers were missed. */
  recentMisses: number;
  /** Its Counted Answers, by Recall Grade. */
  countedAnswers: AnswersByGrade;
};

/** How many answers had each Recall Grade. */
export type AnswersByGrade = Record<RecallGrade, number>;

const noAnswers = (): AnswersByGrade => ({
  MISSED: 0,
  PARTIALLY_CORRECT: 0,
  GOOD: 0,
  NAILED: 0,
});

/** Answers by Recall Grade, added up. */
export function addAnswers(tallies: AnswersByGrade[]): AnswersByGrade {
  const sum = noAnswers();
  for (const tally of tallies) {
    for (const grade of Object.keys(sum) as RecallGrade[]) {
      sum[grade] += tally[grade];
    }
  }
  return sum;
}

/** How many answers there are, given how many had each Recall Grade. */
export function answerCount(answers: AnswersByGrade) {
  return Object.values(answers).reduce((sum, n) => sum + n, 0);
}

/**
 * The share of answers that were right (`isCorrect`), given how many had
 * each Recall Grade; none when there are no answers.
 */
export function accuracy(answers: AnswersByGrade) {
  const total = answerCount(answers);
  const right = (Object.keys(answers) as RecallGrade[])
    .filter(isCorrect)
    .reduce((sum, grade) => sum + answers[grade], 0);
  return total === 0 ? 0 : right / total;
}

/** How many cards are in each Lifecycle State, or of each Mastery Band. */
function countBy<T extends string>(keys: readonly T[], values: T[]) {
  const counts = Object.fromEntries(keys.map((k) => [k, 0])) as Record<
    T,
    number
  >;
  for (const value of values) counts[value]++;
  return counts;
}

const LIFECYCLE_STATES = Object.values(CardLifecycleState);

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
  unretiredAt: true,
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
 * The cards whose standing is read: every card in a learner's decks, the
 * decks in the order given, or just the cards given, without the rest of
 * their decks.
 */
type CardsRead = { deckIds: string[] } | { cardIds: string[] };

/**
 * The standing of a learner's cards (`CardsRead`), in one Study Direction
 * or, when none is given, both, for a Study Mode (Study unless given): each
 * deck in deck order, a card's Forward before its Reverse.
 */
export async function readCardStanding(
  prisma: PrismaClient,
  {
    userId,
    direction,
    studyMode = 'STUDY',
    now = new Date(),
    ...read
  }: CardsRead & {
    userId: string;
    direction?: StudyDirection;
    studyMode?: StudyMode;
    now?: Date;
  },
) {
  const progress = await prisma.cardProgress.findMany({
    where: {
      userId,
      ...('deckIds' in read
        ? { deckId: { in: read.deckIds } }
        : { cardId: { in: read.cardIds } }),
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
  if ('deckIds' in read) {
    // The decks in the order asked, each in deck order (a stable sort)
    const deckPosition = new Map(read.deckIds.map((id, i) => [id, i]));
    progress.sort(
      (a, b) => deckPosition.get(a.deckId)! - deckPosition.get(b.deckId)!,
    );
  }
  const tallies = await countedAnswers(prisma, userId, progress);

  const standings = progress.map((card) => {
    const due = dueFrom(card, studyMode);
    const {
      recentMisses: cardMisses,
      byGrade,
      latest,
    } = tallies.get(key(card)) ?? {
      recentMisses: 0,
      byGrade: noAnswers(),
      latest: null,
    };
    const standing: CardStanding = {
      cardId: card.cardId,
      deckId: card.deckId,
      direction: card.direction,
      lifecycleState: card.lifecycleState,
      masteryBand: masteryBand(card.masteryScore),
      isKnown: isKnown(card.lifecycleState),
      isDue: due !== null && due <= now,
      dueAt: due,
      isWeak: isWeak(card, cardMisses),
      isRetirable: isRetirable(card, latest),
      recentMisses: cardMisses,
      countedAnswers: byGrade,
    };
    return { standing, progress: card };
  });

  const cards = standings.map(({ standing }) => standing);
  return {
    cards,
    due: standings
      .filter(({ standing }) => standing.isDue)
      .sort((a, b) => byDueTime(a.progress, b.progress))
      .map(({ standing }) => standing),
    // Ranked by recent misses, then mastery, then how overdue (§10, §13)
    weak: standings
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
      lifecycle: countBy(
        LIFECYCLE_STATES,
        cards.map((card) => card.lifecycleState),
      ),
      // A NEW card's mastery says nothing yet
      bands: countBy(
        MASTERY_BANDS,
        cards
          .filter((card) => card.lifecycleState !== 'NEW')
          .map((card) => card.masteryBand),
      ),
      answers: addAnswers(cards.map((card) => card.countedAnswers)),
    },
    // When the next card not yet due comes due in the Study Mode
    nextDueAt: cards.reduce<Date | null>(
      (next, { dueAt }) =>
        dueAt && dueAt > now && (!next || dueAt < next) ? dueAt : next,
      null,
    ),
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
 * Each card's Counted Answers in each Study Direction, answers since its
 * progress there last reset (ADR-0004), Retries and answers reviewing a
 * retired card (#86) left out: how many of its
 * last RECENT_ANSWERS were missed, and how many had each Recall Grade. A
 * NEW card has none: it has had no answer since.
 */
async function countedAnswers(
  prisma: PrismaClient,
  userId: string,
  progress: Progress[],
) {
  const cards = progress.filter(
    ({ lifecycleState }) => lifecycleState !== 'NEW',
  );
  const attempts = await prisma.cardAttempt.findMany({
    where: {
      cardId: { in: [...new Set(cards.map((card) => card.cardId))] },
      studySession: { userId, studyMode: { not: 'REVIEW_RETIRED' } },
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
  const tallies = new Map<
    string,
    {
      answers: number;
      recentMisses: number;
      byGrade: AnswersByGrade;
      latest: { recallGrade: RecallGrade; answeredAt: Date } | null;
    }
  >();
  // Newest first, so each card's first RECENT_ANSWERS are its last
  for (const attempt of attempts) {
    const reset = resetAt.get(key(attempt));
    if (!reset || !countsSinceReset(attempt.createdAt, reset)) continue;
    const card = tallies.get(key(attempt)) ?? {
      answers: 0,
      recentMisses: 0,
      byGrade: noAnswers(),
      // Newest first, so the first is the latest
      latest: {
        recallGrade: attempt.recallGrade,
        answeredAt: attempt.createdAt,
      },
    };
    if (card.answers < RECENT_ANSWERS && attempt.recallGrade === 'MISSED') {
      card.recentMisses++;
    }
    card.answers++;
    card.byGrade[attempt.recallGrade]++;
    tallies.set(key(attempt), card);
  }
  return tallies;
}

/** The standing of a learner's cards, as `readCardStanding` reads it. */
export type Standings = Awaited<ReturnType<typeof readCardStanding>>;

/**
 * Where each card stands on retiring, across every Study Direction its deck
 * is studied in, as both directions retire together (#86): whether it's
 * retired, as it is in any of them (a deck made reversible since it retired
 * studies Reverse afresh), and whether the app suggests retiring it, which it
 * does only once every one of them is retirable. Given standings read in
 * both directions.
 */
export function cardRetirement(standings: CardStanding[]) {
  const cards = new Map<string, { retired: boolean; retirable: boolean }>();
  for (const standing of standings) {
    const card = cards.get(standing.cardId) ?? {
      retired: false,
      retirable: true,
    };
    cards.set(standing.cardId, {
      retired: card.retired || standing.lifecycleState === 'RETIRED',
      retirable: card.retirable && standing.isRetirable,
    });
  }
  return cards;
}

/**
 * How many of a learner's cards in a deck are retired (#86): Forward always
 * retires with the card, so it's counted there.
 */
export function countRetiredCards(
  prisma: PrismaClient,
  { userId, deckId }: { userId: string; deckId: string },
) {
  return prisma.cardProgress.count({
    where: { userId, deckId, direction: 'FORWARD', lifecycleState: 'RETIRED' },
  });
}

/**
 * The client or transaction card progress is changed through: the caller
 * decides when a change happens and owns its transaction, and Card
 * Standing how it changes, inside it.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/** One Study Direction of a learner's card, whose progress changes. */
type CardInDirection = {
  userId: string;
  cardId: string;
  direction: StudyDirection;
};

/** The key of a card's progress in one Study Direction. */
const progressKey = ({ userId, cardId, direction }: CardInDirection) => ({
  userId_cardId_direction: { userId, cardId, direction },
});

/** An answer to a card, as it was recorded. */
export type RecordedAnswer = {
  id: string;
  cardId: string;
  direction: StudyDirection;
  recallGrade: RecallGrade;
  createdAt: Date;
  studySessionId: string;
  isRetry: boolean;
};

/**
 * A learner's Counted Answers to a card in a Study Direction, oldest
 * first, as the scheduler takes them: those since its progress there last
 * reset (`countsSinceReset`, as a query), Retries and answers reviewing a
 * retired card (#86) left out, and the one being applied, when given.
 */
async function findCountedAnswers(
  db: Db,
  {
    resetAt,
    exceptAttemptId,
    ...card
  }: CardInDirection & { resetAt: Date; exceptAttemptId?: string },
): Promise<ScheduledAnswer[]> {
  const attempts = await db.cardAttempt.findMany({
    where: {
      cardId: card.cardId,
      direction: card.direction,
      studySession: {
        userId: card.userId,
        studyMode: { not: 'REVIEW_RETIRED' },
      },
      createdAt: { gte: resetAt },
      isRetry: false,
      ...(exceptAttemptId && { id: { not: exceptAttemptId } }),
    },
    orderBy: { createdAt: 'asc' },
    select: { recallGrade: true, createdAt: true, studySessionId: true },
  });
  return attempts.map(toScheduledAnswer);
}

function toScheduledAnswer(attempt: {
  recallGrade: RecallGrade;
  createdAt: Date;
  studySessionId: string;
}): ScheduledAnswer {
  return {
    recallGrade: attempt.recallGrade,
    answeredAt: attempt.createdAt,
    studySessionId: attempt.studySessionId,
  };
}

/**
 * Applies a learner's answer, just recorded, to its card's progress in the
 * answer's Study Direction, given the Counted Answers before it (#7, #11).
 * A Retry is recorded but changes nothing: the first answer already did.
 */
export async function applyCardAnswer(
  db: Db,
  { userId, attempt }: { userId: string; attempt: RecordedAnswer },
) {
  if (attempt.isRetry) return;
  const card = { userId, cardId: attempt.cardId, direction: attempt.direction };
  const progress = await db.cardProgress.findUniqueOrThrow({
    where: progressKey(card),
  });
  const earlier = await findCountedAnswers(db, {
    ...card,
    resetAt: progress.resetAt,
    exceptAttemptId: attempt.id,
  });
  await db.cardProgress.update({
    where: progressKey(card),
    data: applyAnswer(progress, toScheduledAnswer(attempt), earlier),
  });
}

/**
 * The learner's Lifecycle Marks on a card's progress since its last reset,
 * which replay applies between its answers: when they last marked it known
 * (ADR-0009), retired it and unretired it (#86).
 */
function lifecycleMarks(progress: {
  markedKnownAt: Date | null;
  retiredAt: Date | null;
  unretiredAt: Date | null;
}): LifecycleMark[] {
  const marks: LifecycleMark[] = [];
  if (progress.markedKnownAt) {
    marks.push({ kind: 'MARKED_KNOWN', at: progress.markedKnownAt });
  }
  if (progress.retiredAt) {
    marks.push({ kind: 'RETIRED', at: progress.retiredAt });
  }
  if (progress.unretiredAt) {
    marks.push({ kind: 'UNRETIRED', at: progress.unretiredAt });
  }
  return marks;
}

/**
 * Rebuilds a card's progress in a Study Direction from its Counted
 * Answers, as now graded, and the learner's lifecycle marks, in time
 * order (`replayAnswers`): for when an answer is graded again ("My answer
 * was correct").
 */
export async function replayCardAnswers(db: Db, card: CardInDirection) {
  const progress = await db.cardProgress.findUniqueOrThrow({
    where: progressKey(card),
  });
  await db.cardProgress.update({
    where: progressKey(card),
    data: replayAnswers(
      await findCountedAnswers(db, { ...card, resetAt: progress.resetAt }),
      lifecycleMarks(progress),
    ),
  });
}

/**
 * Marks a learner's cards known at `at` (ADR-0009) in the given Study
 * Directions (ADR-0011): NEW and LEARNING progress takes `markKnown`'s, and
 * progress already known is left as it is. Returns how many directions of
 * cards were marked.
 */
export async function recordMarkedKnown(
  db: Db,
  {
    userId,
    cardIds,
    directions,
    at,
  }: {
    userId: string;
    cardIds: string[];
    directions: StudyDirection[];
    at: Date;
  },
) {
  const progresses = await db.cardProgress.findMany({
    where: { userId, cardId: { in: cardIds }, direction: { in: directions } },
  });
  let markedCount = 0;
  for (const progress of progresses) {
    const known = markKnown(progress, at);
    if (!known) continue;
    await db.cardProgress.update({ where: { id: progress.id }, data: known });
    markedCount++;
  }
  return markedCount;
}

/**
 * A learner's progress with cards in every Study Direction their decks are
 * studied in: Forward, and Reverse on a Reversible Deck (ADR-0011).
 */
function studiedProgress(db: Db, userId: string, cardIds: string[]) {
  return db.cardProgress.findMany({
    where: {
      userId,
      cardId: { in: cardIds },
      OR: [{ direction: 'FORWARD' }, { card: { deck: { reversible: true } } }],
    },
  });
}

/**
 * Retires a learner's cards at `at` in every Study Direction their decks are
 * studied in (#86), keeping their mastery, schedule and history. The caller
 * decides which cards the learner has chosen to retire. Returns how many
 * cards were retired.
 */
export async function recordRetired(
  db: Db,
  { userId, cardIds, at }: { userId: string; cardIds: string[]; at: Date },
) {
  const progresses = await studiedProgress(db, userId, cardIds);
  for (const progress of progresses) {
    await db.cardProgress.update({
      where: { id: progress.id },
      data: retire(progress, at),
    });
  }
  return new Set(progresses.map((progress) => progress.cardId)).size;
}

/**
 * Unretires a learner's cards at `at` (#86): each retired direction back to
 * Reinforcing with its mastery, due straight away; progress not retired is
 * left as it is. Returns how many cards were unretired.
 */
export async function recordUnretired(
  db: Db,
  { userId, cardIds, at }: { userId: string; cardIds: string[]; at: Date },
) {
  const unretired = new Set<string>();
  for (const progress of await studiedProgress(db, userId, cardIds)) {
    const next = unretire(progress, at);
    if (!next) continue;
    await db.cardProgress.update({ where: { id: progress.id }, data: next });
    unretired.add(progress.cardId);
  }
  return unretired.size;
}

/**
 * Takes back the learner's retiring of cards (#86), as if it never
 * happened: each retired direction's retire mark is cleared and its
 * progress rebuilt from its Counted Answers and the learner's other marks
 * (`replayCardAnswers`), so it's as it stood before, and can retire again.
 * Progress not retired is left as it is. Returns how many cards it undid.
 */
export async function recordRetireUndone(
  db: Db,
  { userId, cardIds }: { userId: string; cardIds: string[] },
) {
  const undone = new Set<string>();
  for (const progress of await studiedProgress(db, userId, cardIds)) {
    if (progress.lifecycleState !== 'RETIRED') continue;
    await db.cardProgress.update({
      where: { id: progress.id },
      data: { retiredAt: null },
    });
    await replayCardAnswers(db, {
      userId,
      cardId: progress.cardId,
      direction: progress.direction,
    });
    undone.add(progress.cardId);
  }
  return undone.size;
}

/** Every Study Direction, in each of which every card has progress. */
export const STUDY_DIRECTIONS: StudyDirection[] = ['FORWARD', 'REVERSE'];

/**
 * Starts a new card's progress for its deck's owner: NEW in each Study
 * Direction, studied in Reverse or not (ADR-0011), from `startedAt`, when
 * its first Card Version starts.
 */
export function startCardProgress(
  db: Db,
  {
    userId,
    deckId,
    cardId,
    startedAt,
  }: { userId: string; deckId: string; cardId: string; startedAt: Date },
) {
  return db.cardProgress.createMany({
    data: STUDY_DIRECTIONS.map((direction) => ({
      userId,
      deckId,
      cardId,
      direction,
      resetAt: startedAt,
    })),
  });
}

/**
 * Resets a card's progress to NEW in every Study Direction from `resetAt`,
 * when an edit changes what it asks (ADR-0004): its answers are kept, but
 * only those since count. One direction alone when given, as a history
 * recorded for one direction starts it.
 */
export function resetCardProgress(
  db: Db,
  {
    cardId,
    direction,
    resetAt,
  }: { cardId: string; direction?: StudyDirection; resetAt: Date },
) {
  return db.cardProgress.updateMany({
    where: { cardId, ...(direction && { direction }) },
    data: { ...NEW_PROGRESS, resetAt },
  });
}

/**
 * Whether an answer to a card was given since its progress in that Study
 * Direction last reset, so it counts (ADR-0004); one from before answered
 * what was effectively a different card.
 */
export async function answeredSinceReset(
  db: Db,
  { answeredAt, ...card }: CardInDirection & { answeredAt: Date },
) {
  const { resetAt } = await db.cardProgress.findUniqueOrThrow({
    where: progressKey(card),
    select: { resetAt: true },
  });
  return countsSinceReset(answeredAt, resetAt);
}
