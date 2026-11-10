import {
  Prisma,
  type PrismaClient,
  type SessionType,
  type StudyDirection,
  type StudyMode,
} from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { NO_MATCH, type Grading } from './answerGrader.js';
import {
  acceptedFront,
  addAcceptedVariant,
  alreadyAccepts,
  addReverseVariant,
  alreadyAcceptsFront,
  currentVersionId,
  findCardsSharingAnswer,
  gradeDirectedAnswer,
  withCanonicalAnswers,
} from './cards.js';
import { isCorrect } from './countedAttempts.js';
import { assertDeckActive, assertStudiesIn } from './decks.js';
import {
  answeredSinceReset,
  applyCardAnswer,
  type CardStanding,
  readCardStanding,
  replayCardAnswers,
} from './cardStanding.js';
import { newPerDayByDates, readCramDates } from './cramDate.js';
import {
  composeQueue,
  findQueueCandidates,
  countPooled,
  poolStandings,
  queueCandidates,
} from './queueGenerator.js';

/**
 * Include for returning a Study Session with its items in queue order, each
 * with its answer, once answered.
 */
const withItems = {
  items: {
    orderBy: { position: 'asc' },
    include: {
      // Its deck, as a Today's Review's cards come from several (#137)
      card: {
        include: {
          ...withCanonicalAnswers,
          deck: {
            select: {
              id: true,
              name: true,
              reversible: true,
              forwardLabel: true,
              reverseLabel: true,
            },
          },
        },
      },
      attempts: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, userAnswer: true, recallGrade: true },
      },
    },
  },
} as const;

/**
 * How long after its last activity an unfinished Study Session can be
 * resumed (`updated-plan.md` §12.4); after that it's abandoned.
 */
const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The time before which a session's last activity makes it too old to resume. */
function resumeCutoff() {
  return new Date(Date.now() - RESUME_WINDOW_MS);
}

/**
 * The learner's unfinished Study Session on a deck that can still be
 * resumed, active since `cutoff`, with its queue; null when there's none.
 */
export function findResumableSession(
  prisma: PrismaClient,
  { userId, deckId }: LearnerDeck,
  cutoff = resumeCutoff(),
) {
  return prisma.studySession.findFirst({
    where: { userId, deckId, status: 'ACTIVE', updatedAt: { gte: cutoff } },
    include: withItems,
  });
}

/**
 * How many times at most a missed card comes back in one session
 * (`learning-model-and-scheduler.md` §10).
 */
const MAX_RETRIES = 2;

/** A learner's cards in one deck. */
type LearnerDeck = { userId: string; deckId: string };

/** How the learner chooses to study: a session's type, mode and direction. */
export type SessionChoice = {
  sessionType: SessionType;
  studyMode: StudyMode;
  direction: StudyDirection;
};

/**
 * What a Study Session of the given type, mode and direction started now
 * would hold: its size, as starting it would compose it, how many cards are
 * due in the Study Mode and how many NEW, and, for when it would hold
 * nothing, when the next card comes due in the mode. All from one read of
 * the cards' standing, so they agree.
 */
export async function previewQueue(
  prisma: PrismaClient,
  { userId, deckId }: LearnerDeck,
  { sessionType, studyMode, direction }: SessionChoice,
) {
  const standings = await readCardStanding(prisma, {
    userId,
    deckIds: [deckId],
    direction,
    studyMode,
  });
  const candidates = queueCandidates(standings, studyMode);
  const queue = composeQueue({
    candidates,
    sessionType,
    studyMode,
    seed: 0,
  });
  return {
    // Its order varies with the seed, never its size
    sessionSize: queue.length,
    dueCount: standings.counts.due,
    newCount: standings.counts.lifecycle.NEW,
    nextDueAt: standings.nextDueAt,
    // An unfinished Today's Review starting would end
    wouldEnd: await findSessionsEndedBy(prisma, {
      userId,
      starting: { kind: 'DECK', deckId },
    }),
    // How the Cram date paces NEW cards, and how many of them a session
    // takes, which may be fewer than the date needs (#87)
    cramPace:
      standings.newPerDay === null
        ? null
        : {
            newPerDay: standings.newPerDay,
            inSession: queue.filter((id) => candidates.newCards.includes(id))
              .length,
          },
  };
}

/**
 * Abandons the learner's unfinished Study Sessions on a deck that are too
 * old to resume, ending each at its last activity. Their queues are left
 * as they were (`updated-plan.md` §12.4).
 */
function abandonStaleSessions(
  prisma: PrismaClient,
  { userId, deckId }: LearnerDeck,
  cutoff: Date,
) {
  return abandonSessions(prisma, {
    userId,
    deckId,
    updatedAt: { lt: cutoff },
  });
}

/**
 * Abandons the unfinished Study Sessions that match, each ended at its last
 * activity, its answers and queue left as they were.
 */
async function abandonSessions(
  prisma: PrismaClient,
  where: Prisma.StudySessionWhereInput,
) {
  const ending = await prisma.studySession.findMany({
    where: { ...where, status: 'ACTIVE' },
    select: { id: true, updatedAt: true },
  });
  for (const { id, updatedAt } of ending) {
    await prisma.studySession.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'ABANDONED', endedAt: updatedAt },
    });
  }
}

/**
 * Starts a Study Session of the given type, mode and Study Direction on a
 * deck, or resumes the learner's unfinished one, in its own direction, if
 * it's recent enough (`findResumableSession`), abandoning one that's too
 * old. The queue is composed from the deck's cards by the session type
 * and mode (`composeQueue`), in an order fixed by `seed`, random unless
 * given.
 * Returns null, and starts nothing, when the deck has nothing to study.
 */
export async function startStudySession(
  prisma: PrismaClient,
  { userId, deckId }: LearnerDeck,
  {
    sessionType,
    studyMode,
    direction,
    seed = Math.floor(Math.random() * 2 ** 32),
  }: SessionChoice & { seed?: number },
) {
  // One cutoff for both, so no session falls between them
  const cutoff = resumeCutoff();
  await abandonStaleSessions(prisma, { userId, deckId }, cutoff);
  const resumable = await findResumableSession(
    prisma,
    { userId, deckId },
    cutoff,
  );
  if (resumable) return resumable;

  const queue = composeQueue({
    candidates: await findQueueCandidates(
      prisma,
      { userId, deckId, direction },
      { studyMode },
    ),
    sessionType,
    studyMode,
    seed,
  });
  if (queue.length === 0) return null;
  await abandonSessions(
    prisma,
    sessionsSharing({ userId, starting: { kind: 'DECK', deckId } }),
  );

  try {
    return await prisma.studySession.create({
      data: {
        userId,
        deckId,
        sessionType,
        studyMode,
        direction,
        decks: { create: { deckId } },
        items: {
          create: queue.map((cardId, position) => ({
            cardId,
            direction,
            position,
          })),
        },
      },
      include: withItems,
    });
  } catch (error) {
    // Another start got there first: a learner has one unfinished session
    // on a deck (StudySession_one_active_per_deck), which this resumes
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const started = await findResumableSession(prisma, { userId, deckId });
      if (started) return started;
    }
    throw error;
  }
}

/** What a starting session is: a deck's own, or Today's Review. */
type StartingSession =
  | { kind: 'DECK'; deckId: string }
  | { kind: 'TODAYS_REVIEW'; deckIds: string[] };

/**
 * The learner's other unfinished sessions sharing a deck with one starting,
 * which starting it ends (ADR-0013): for a deck's own session, a Today's
 * Review built from its deck; for Today's Review, the ticked decks' own
 * sessions. Two decks' own sessions share none.
 */
function sessionsSharing({
  userId,
  starting,
}: {
  userId: string;
  starting: StartingSession;
}): Prisma.StudySessionWhereInput {
  return starting.kind === 'DECK'
    ? {
        userId,
        kind: 'TODAYS_REVIEW',
        decks: { some: { deckId: starting.deckId } },
      }
    : { userId, kind: 'DECK', deckId: { in: starting.deckIds } };
}

/**
 * The unfinished sessions starting one would end, for its title card to
 * say so beforehand: those still to resume, each with its kind and a deck's
 * own session's deck.
 */
async function findSessionsEndedBy(
  prisma: PrismaClient,
  { userId, starting }: { userId: string; starting: StartingSession },
) {
  const sessions = await prisma.studySession.findMany({
    where: {
      ...sessionsSharing({ userId, starting }),
      status: 'ACTIVE',
      updatedAt: { gte: resumeCutoff() },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, kind: true, deck: { select: { name: true } } },
  });
  return sessions.map(({ id, kind, deck }) => ({
    id,
    kind,
    deckName: deck?.name ?? null,
  }));
}

/** Today's Review's choice: Review retired is a deck's alone. */
export type ReviewChoice = {
  sessionType: SessionType;
  studyMode: Exclude<StudyMode, 'REVIEW_RETIRED'>;
};

/**
 * The decks Today's Review takes: those Flashcards lists that the learner
 * hasn't left out (#115), oldest first, the order its new cards take turns
 * in.
 */
async function findTickedDeckIds(prisma: PrismaClient, userId: string) {
  const decks = await prisma.deck.findMany({
    where: { userId, archivedAt: null, leftOutOfToday: false },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return decks.map((deck) => deck.id);
}

/**
 * Today's Review's cards now in a Study Mode: one read of the ticked
 * decks' Card Standing, in both directions, pooled (`poolStandings`), with
 * Cram's pace toward the decks' dates counting each card once.
 */
async function readTodaysReview(
  prisma: PrismaClient,
  userId: string,
  studyMode: ReviewChoice['studyMode'],
  now = new Date(),
) {
  const deckIds = await findTickedDeckIds(prisma, userId);
  const standings = await readCardStanding(prisma, {
    userId,
    deckIds,
    studyMode,
    now,
  });
  const pooled = poolStandings(standings, studyMode);
  const newCards = pooled.cards.filter((card) => card.lifecycleState === 'NEW');
  return {
    deckIds,
    nextDueAt: standings.nextDueAt,
    pooled: {
      ...pooled,
      newPerDay:
        standings.newPerDay === null
          ? null
          : newPerDayByDates(
              await readCramDates(prisma, deckIds, now),
              newCards,
              now,
            ),
    },
  };
}

/**
 * What Today's Review of the given type and mode started now would hold
 * (#137): its size, as starting it would compose it; its due and new cards,
 * each card once, and how many decks they're from; when the next card on a
 * ticked deck comes due, for when it would hold nothing; and the unfinished
 * sessions starting it would end.
 */
export async function previewTodaysReview(
  prisma: PrismaClient,
  { userId }: { userId: string },
  { sessionType, studyMode }: ReviewChoice,
) {
  const { deckIds, nextDueAt, pooled } = await readTodaysReview(
    prisma,
    userId,
    studyMode,
  );
  const queue = composeQueue({
    candidates: queueCandidates(pooled, studyMode),
    sessionType,
    studyMode,
    seed: 0,
  });
  return {
    sessionSize: queue.length,
    ...countPooled(pooled),
    nextDueAt,
    wouldEnd: await findSessionsEndedBy(prisma, {
      userId,
      starting: { kind: 'TODAYS_REVIEW', deckIds },
    }),
  };
}

/** The pooled standing of each card asked, by its id. */
function standingOf(pooled: { cards: CardStanding[] }) {
  const cards = new Map(pooled.cards.map((card) => [card.cardId, card]));
  return (cardId: string) => cards.get(cardId)!;
}

/** The learner's unfinished Today's Review, active since `cutoff`. */
function resumableReview(
  userId: string,
  cutoff: Date,
): Prisma.StudySessionWhereInput {
  return {
    userId,
    kind: 'TODAYS_REVIEW',
    status: 'ACTIVE',
    updatedAt: { gte: cutoff },
  };
}

/**
 * The learner's unfinished Today's Review that can still be resumed,
 * active since `cutoff`, with its queue; null when there's none.
 */
export function findResumableReview(
  prisma: PrismaClient,
  { userId }: { userId: string },
  cutoff = resumeCutoff(),
) {
  return prisma.studySession.findFirst({
    where: resumableReview(userId, cutoff),
    include: withItems,
  });
}

/**
 * Skips an archived deck's cards still to come in unfinished Today's
 * Reviews, which go on with the other decks' (#137).
 */
export function skipArchivedDeckInReviews(
  tx: Prisma.TransactionClient,
  deckId: string,
) {
  return tx.studySessionItem.updateMany({
    where: {
      status: 'PENDING',
      card: { deckId },
      studySession: { kind: 'TODAYS_REVIEW', status: 'ACTIVE' },
    },
    data: { status: 'SKIPPED' },
  });
}

/**
 * Starts Today's Review (ADR-0013, #137): one Study Session across the
 * ticked decks, recording them, its queue composed from their pooled
 * standing by the session type and mode, each card in the direction the
 * pool chose; or resumes the learner's unfinished one if it's recent
 * enough, abandoning one that's too old. Starting ends the ticked decks'
 * own unfinished sessions. Returns null, and starts nothing, when no
 * ticked deck has anything to study.
 */
export async function startTodaysReview(
  prisma: PrismaClient,
  { userId }: { userId: string },
  {
    sessionType,
    studyMode,
    seed = Math.floor(Math.random() * 2 ** 32),
  }: ReviewChoice & { seed?: number },
) {
  const cutoff = resumeCutoff();
  await abandonSessions(prisma, {
    userId,
    kind: 'TODAYS_REVIEW',
    updatedAt: { lt: cutoff },
  });
  const resumable = await findResumableReview(prisma, { userId }, cutoff);
  if (resumable) return resumable;

  const { deckIds, pooled } = await readTodaysReview(prisma, userId, studyMode);
  const queue = composeQueue({
    candidates: queueCandidates(pooled, studyMode),
    sessionType,
    studyMode,
    seed,
  });
  if (queue.length === 0) return null;
  const asked = standingOf(pooled);
  await abandonSessions(
    prisma,
    sessionsSharing({
      userId,
      starting: { kind: 'TODAYS_REVIEW', deckIds },
    }),
  );

  try {
    return await prisma.studySession.create({
      data: {
        userId,
        kind: 'TODAYS_REVIEW',
        sessionType,
        studyMode,
        decks: { create: deckIds.map((deckId) => ({ deckId })) },
        items: {
          create: queue.map((cardId, position) => ({
            cardId,
            direction: asked(cardId).direction,
            position,
          })),
        },
      },
      include: withItems,
    });
  } catch (error) {
    // Another start got there first: a learner has one unfinished Today's
    // Review (StudySession_one_active_todays_review), which this resumes
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const started = await findResumableReview(prisma, { userId });
      if (started) return started;
    }
    throw error;
  }
}

/**
 * How far the learner's unfinished Today's Review has got, for Today's
 * tile: its cards answered or skipped out of all of them, Retries left out;
 * null when there's none to resume.
 */
export async function todaysReviewProgress(
  prisma: PrismaClient,
  { userId }: { userId: string },
) {
  const review = await prisma.studySession.findFirst({
    where: resumableReview(userId, resumeCutoff()),
    select: { items: { where: { isRetry: false }, select: { status: true } } },
  });
  if (!review) return null;
  return {
    answered: review.items.filter((item) => item.status !== 'PENDING').length,
    size: review.items.length,
  };
}

/**
 * Brings a missed card back at the end of its session, after every card
 * and earlier Retry, at most MAX_RETRIES times, asked the way it was.
 * Returns the new item, or null once the card has come back as often as it
 * may.
 */
async function queueRetry(
  tx: Prisma.TransactionClient,
  {
    studySessionId,
    cardId,
    direction,
  }: { studySessionId: string; cardId: string; direction: StudyDirection },
) {
  const retries = await tx.studySessionItem.count({
    where: { studySessionId, cardId, isRetry: true },
  });
  if (retries >= MAX_RETRIES) return null;

  const last = await tx.studySessionItem.aggregate({
    where: { studySessionId },
    _max: { position: true },
  });
  return tx.studySessionItem.create({
    data: {
      studySessionId,
      cardId,
      direction,
      position: (last._max.position ?? -1) + 1,
      isRetry: true,
    },
    select: { id: true },
  });
}

type CardToGrade = Parameters<typeof gradeDirectedAnswer>[1] &
  Parameters<typeof findCardsSharingAnswer>[1];

/**
 * Grades a typed answer to a card in a Study Session. In Reverse, a card
 * sharing its primary answer with others accepts their fronts too, naming
 * the one accepted (`otherFront`), but not a front already given correctly
 * for one of them in this session: that is refused ungraded, with
 * PRECONDITION_FAILED, which answering a card throws for nothing else, so
 * the study screen can tell it apart (#96, ADR-0012).
 */
async function gradeInSession(
  prisma: PrismaClient,
  {
    studySessionId,
    card,
    direction,
  }: { studySessionId: string; card: CardToGrade; direction: StudyDirection },
  userAnswer: string,
): Promise<{ grading: Grading; otherFront: string | null }> {
  const ungrouped = () => ({
    grading: gradeDirectedAnswer(userAnswer, card, direction),
    otherFront: null,
  });
  if (direction === 'FORWARD') return ungrouped();
  const sharing = await findCardsSharingAnswer(prisma, card);
  const group = [card, ...sharing];
  const accepted = acceptedFront(userAnswer, group);
  if (sharing.length === 0 || !accepted) return ungrouped();

  const correctAnswers = await prisma.cardAttempt.findMany({
    where: {
      studySessionId,
      cardId: { in: sharing.map((other) => other.id) },
      recallGrade: { not: 'MISSED' },
    },
    select: { cardId: true, userAnswer: true },
  });
  // The front an earlier answer gave: the one it's accepted as, its own
  // card's tried first, as when it was graded
  function frontGiven(answer: { cardId: string; userAnswer: string | null }) {
    const answeredCard = group.find((member) => member.id === answer.cardId)!;
    const rest = group.filter((member) => member !== answeredCard);
    return answer.userAnswer === null
      ? null
      : acceptedFront(answer.userAnswer, [answeredCard, ...rest])?.front;
  }
  if (correctAnswers.some((answer) => frontGiven(answer) === accepted.front)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `${accepted.front} already correctly guessed. Give a different answer.`,
    });
  }
  return {
    grading: accepted.grading,
    otherFront: accepted.front === card.front ? null : accepted.front,
  };
}

/**
 * Grades the answer to one Study Session item. In one transaction it
 * completes the item, saves the attempt and updates the card's progress
 * (`updated-plan.md` §11.3). A null answer is "I don't know", a MISSED
 * attempt (§5.2). A missed card comes back at the end of the session
 * (`queueRetry`), and the answer to its Retry leaves the card's progress
 * as the first answer left it. In Reverse, cards sharing an answer accept
 * each other's fronts (`gradeInSession`). Returns the attempt, whether it
 * was an Accent Mismatch, the Accepted Variant it matched, if any, the
 * other card's front it was accepted as, if any, and the item the card
 * comes back as. A front already given in the session is refused, and
 * nothing is recorded.
 */
export async function answerItem(
  prisma: PrismaClient,
  {
    userId,
    itemId,
    userAnswer,
  }: { userId: string; itemId: string; userAnswer: string | null },
) {
  const item = await prisma.studySessionItem.findFirst({
    where: { id: itemId, studySession: { userId } },
    include: {
      card: {
        include: {
          ...withCanonicalAnswers,
          deck: { select: { archivedAt: true, reversible: true } },
        },
      },
      studySession: { select: { status: true, studyMode: true, kind: true } },
    },
  });
  if (!item) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Study session card not found',
    });
  }
  // A session started before the card's deck was archived: Today's Review
  // skips the card, going on with the other decks' (#137)
  if (
    item.card.deck.archivedAt &&
    item.studySession.kind === 'TODAYS_REVIEW' &&
    item.studySession.status === 'ACTIVE'
  ) {
    await prisma.studySessionItem.updateMany({
      where: { id: item.id, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
  }
  assertDeckActive(item.card.deck);
  if (item.studySession.status !== 'ACTIVE') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Session already finished',
    });
  }
  const { direction } = item;
  // Asked in Reverse on a deck turned one-way meanwhile
  assertStudiesIn(item.card.deck, direction);

  const {
    grading: { recallGrade, accentMismatch, matchedAnswer, matchedVariant },
    otherFront,
  } =
    userAnswer === null
      ? { grading: NO_MATCH, otherFront: null }
      : await gradeInSession(
          prisma,
          { studySessionId: item.studySessionId, card: item.card, direction },
          userAnswer,
        );
  return prisma.$transaction(async (tx) => {
    // Answers in one session take turns, so they number their attempts and
    // queue their Retries one at a time
    await tx.studySession.update({
      where: { id: item.studySessionId },
      data: { updatedAt: new Date() },
    });
    // Completing only a PENDING item keeps two concurrent answers from both
    // counting.
    const completed = await tx.studySessionItem.updateMany({
      where: { id: item.id, status: 'PENDING' },
      data: { status: 'COMPLETED' },
    });
    if (completed.count === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Card already answered in this session',
      });
    }

    const earlierInSession = await tx.cardAttempt.count({
      where: { studySessionId: item.studySessionId, cardId: item.cardId },
    });
    const attempt = await tx.cardAttempt.create({
      data: {
        studySessionId: item.studySessionId,
        studySessionItemId: item.id,
        cardId: item.cardId,
        cardVersionId: await currentVersionId(tx, item.cardId),
        direction,
        userAnswer,
        recallGrade,
        attemptNumber: earlierInSession + 1,
        isRetry: item.isRetry,
        gradingMethod: 'DETERMINISTIC',
      },
    });

    // A retired card reviewed is quizzed, never scheduled (#86)
    if (item.studySession.studyMode !== 'REVIEW_RETIRED') {
      await applyCardAnswer(tx, { userId, attempt });
    }

    const retryItem =
      recallGrade === 'MISSED' ? await queueRetry(tx, item) : null;
    return {
      ...attempt,
      accentMismatch,
      matchedAnswer,
      matchedVariant,
      otherFront,
      retryItem,
    };
  });
}

/**
 * "My answer was correct": accepts a typed answer graded MISSED. The answer
 * becomes an Accepted Variant of the card's primary Canonical Answer, or of
 * the one given, or, answered in Reverse, a Reverse Variant of its front
 * (ADR-0011), unless grading already accepts it, and is graded again.
 * The attempt becomes the final one, recording the MISSED it first had
 * (`updated-plan.md` §11.1), and the card's progress is rebuilt from its
 * counted attempts as if it had been graded so from the start, and its
 * retry waiting in the session is skipped. Returns the new grade and the
 * card.
 */
export async function acceptAnswer(
  prisma: PrismaClient,
  {
    userId,
    attemptId,
    canonicalAnswerId,
  }: { userId: string; attemptId: string; canonicalAnswerId?: string },
) {
  const attempt = await prisma.cardAttempt.findFirst({
    where: {
      id: attemptId,
      studySession: { userId },
      card: { deck: { userId } },
    },
    include: {
      card: {
        include: {
          ...withCanonicalAnswers,
          deck: { select: { archivedAt: true, reversible: true } },
        },
      },
    },
  });
  if (!attempt) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Attempt not found' });
  }
  assertDeckActive(attempt.card.deck);
  const { userAnswer, direction } = attempt;
  assertStudiesIn(attempt.card.deck, direction);
  if (attempt.recallGrade !== 'MISSED' || userAnswer === null) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Only a missed typed answer can be accepted',
    });
  }
  // It answered what was effectively a different card
  if (
    !(await answeredSinceReset(prisma, {
      userId,
      cardId: attempt.cardId,
      direction,
      answeredAt: attempt.createdAt,
    }))
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Answered before the card was edited',
    });
  }
  // In Reverse the answer is the front, so there's no Canonical Answer to
  // choose
  const answer =
    direction === 'REVERSE'
      ? null
      : canonicalAnswerId
        ? attempt.card.canonicalAnswers.find((a) => a.id === canonicalAnswerId)
        : attempt.card.canonicalAnswers[0];
  if (answer === undefined) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Canonical answer not found',
    });
  }

  return prisma.$transaction(async (tx) => {
    const card = (
      answer
        ? alreadyAccepts(answer, userAnswer)
        : alreadyAcceptsFront(attempt.card, userAnswer)
    )
      ? attempt.card
      : answer
        ? await addAcceptedVariant(tx, {
            canonicalAnswerId: answer.id,
            text: userAnswer,
          })
        : await addReverseVariant(tx, {
            cardId: attempt.cardId,
            text: userAnswer,
          });
    const grading = gradeDirectedAnswer(userAnswer, card, direction);
    // An answer with no letters or digits never matches, even itself
    if (grading.recallGrade === 'MISSED') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: "That answer can't be accepted",
      });
    }

    // Finalizing only a MISSED attempt keeps two concurrent acceptances from
    // both applying
    const finalized = await tx.cardAttempt.updateMany({
      where: { id: attempt.id, recallGrade: 'MISSED' },
      data: {
        recallGrade: grading.recallGrade,
        initialSuggestedGrade: 'MISSED',
        refinementApplied: true,
        gradingMethod: 'REFINED_VARIANT',
      },
    });
    if (finalized.count === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Answer already accepted',
      });
    }

    // It wasn't missed after all, so it needn't come back
    await tx.studySessionItem.updateMany({
      where: {
        studySessionId: attempt.studySessionId,
        cardId: attempt.cardId,
        isRetry: true,
        status: 'PENDING',
      },
      data: { status: 'SKIPPED' },
    });

    await replayCardAnswers(tx, {
      userId,
      cardId: attempt.cardId,
      direction,
    });

    return { ...grading, card };
  });
}

/** Refuses a Study Session that isn't the learner's, or is over. */
async function assertSessionActive(
  prisma: PrismaClient,
  { userId, id }: { userId: string; id: string },
) {
  const studySession = await prisma.studySession.findFirst({
    where: { id, userId },
  });
  if (!studySession) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Study session not found',
    });
  }
  if (studySession.status !== 'ACTIVE') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Session already finished',
    });
  }
}

/**
 * Finishes a Study Session, at its last card or early: unanswered items are
 * skipped, and the session is completed with an end time.
 */
export async function finishStudySession(
  prisma: PrismaClient,
  { userId, id }: { userId: string; id: string },
) {
  await assertSessionActive(prisma, { userId, id });

  return prisma.$transaction(async (tx) => {
    await tx.studySessionItem.updateMany({
      where: { studySessionId: id, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
    return tx.studySession.update({
      where: { id },
      data: { status: 'COMPLETED', endedAt: new Date() },
      include: withItems,
    });
  });
}

/**
 * Abandons a Study Session the learner chooses not to resume: it ends now,
 * its queue left as it was (`updated-plan.md` §12.4).
 */
export async function abandonStudySession(
  prisma: PrismaClient,
  { userId, id }: { userId: string; id: string },
) {
  await assertSessionActive(prisma, { userId, id });
  // Abandoning only an active session keeps a finish at the same moment
  // from being overwritten
  const abandoned = await prisma.studySession.updateMany({
    where: { id, status: 'ACTIVE' },
    data: { status: 'ABANDONED', endedAt: new Date() },
  });
  if (abandoned.count === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Session already finished',
    });
  }
  return prisma.studySession.findUniqueOrThrow({
    where: { id },
    include: withItems,
  });
}

/** How many recent Study Sessions the stats pages list. */
const RECENT_SESSIONS = 10;

/**
 * A learner's latest finished or abandoned Study Sessions on the given
 * decks, in one Study Direction when given and otherwise in each they're
 * studied in, newest first: when, their type
 * and mode, how they ended, how many cards they answered and how many of
 * those right, Retries left out, and their deck, with its course if any.
 * Decks' own sessions only: Today's Reviews join them in #117.
 */
export async function findRecentSessions(
  prisma: PrismaClient,
  {
    userId,
    deckIds,
    direction,
  }: { userId: string; deckIds: string[]; direction?: StudyDirection },
) {
  const sessions = await prisma.studySession.findMany({
    where: {
      userId,
      kind: 'DECK',
      deckId: { in: deckIds },
      status: { in: ['COMPLETED', 'ABANDONED'] },
      // Reverse none while its deck isn't reversible (ADR-0011)
      ...(direction
        ? { direction }
        : {
            OR: [{ direction: 'FORWARD' }, { deck: { reversible: true } }],
          }),
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    take: RECENT_SESSIONS,
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      sessionType: true,
      studyMode: true,
      direction: true,
      status: true,
      deck: {
        select: {
          id: true,
          name: true,
          course: { select: { id: true, title: true } },
        },
      },
      attempts: {
        where: { isRetry: false },
        select: { recallGrade: true },
      },
    },
  });
  // A deck's own session always has its deck
  return sessions.flatMap(({ attempts, deck, ...session }) =>
    deck
      ? [
          {
            ...session,
            deck,
            answered: attempts.length,
            right: attempts.filter((attempt) => isCorrect(attempt.recallGrade))
              .length,
          },
        ]
      : [],
  );
}
