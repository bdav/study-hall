import {
  Prisma,
  type PrismaClient,
  type RecallGrade,
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
import {
  applyAnswer,
  replayAnswers,
  type ScheduledAnswer,
} from './progressUpdater.js';
import { countsSinceReset } from './countedAttempts.js';
import { assertDeckActive, assertStudiesIn } from './decks.js';
import { composeQueue, findQueueCandidates } from './queueGenerator.js';

/**
 * Include for returning a Study Session with its items in queue order, each
 * with its answer, once answered.
 */
const withItems = {
  items: {
    orderBy: { position: 'asc' },
    include: {
      card: { include: withCanonicalAnswers },
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

/**
 * A learner's counted answers to a card in a Study Direction, oldest
 * first: those since its progress in that direction last reset
 * (`countsSinceReset`, as a query), as the scheduler takes them, leaving
 * out the attempt being applied and retries, which never change the
 * card's progress.
 */
async function findCountedAnswers(
  tx: Prisma.TransactionClient,
  {
    userId,
    cardId,
    direction,
    resetAt,
    exceptAttemptId,
  }: {
    userId: string;
    cardId: string;
    direction: StudyDirection;
    resetAt: Date;
    exceptAttemptId?: string;
  },
): Promise<ScheduledAnswer[]> {
  const attempts = await tx.cardAttempt.findMany({
    where: {
      cardId,
      direction,
      studySession: { userId },
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

/** A learner's cards in one deck. */
type LearnerDeck = { userId: string; deckId: string };

/** A learner's cards in one deck, studied in one Study Direction. */
type DirectedDeck = LearnerDeck & { direction: StudyDirection };

/** A deck's cards in review whose due time has come. */
function dueCardsWhere(deck: DirectedDeck): Prisma.CardProgressWhereInput {
  return {
    ...deck,
    lifecycleState: { in: ['LEARNING', 'REINFORCING'] },
    dueAt: { lte: new Date() },
  };
}

/** A deck's cards that have never been studied in the direction. */
function newCardsWhere(deck: DirectedDeck): Prisma.CardProgressWhereInput {
  return { ...deck, lifecycleState: 'NEW' };
}

/**
 * How many of a deck's cards are due in a Study Direction and how many are
 * NEW there, the cards a Study Session draws from (`findQueueCandidates`).
 */
export async function countDueAndNewCards(
  prisma: PrismaClient,
  deck: DirectedDeck,
) {
  const [dueCount, newCount] = await Promise.all([
    prisma.cardProgress.count({ where: dueCardsWhere(deck) }),
    prisma.cardProgress.count({ where: newCardsWhere(deck) }),
  ]);
  return { dueCount, newCount };
}

/** How the learner chooses to study: a session's type, mode and direction. */
export type SessionChoice = {
  sessionType: SessionType;
  studyMode: StudyMode;
  direction: StudyDirection;
};

/**
 * What a Study Session of the given type, mode and direction started now
 * would hold: its size, as starting it would compose it, and, for when it
 * would hold nothing, when the next card in review comes due.
 */
export async function previewQueue(
  prisma: PrismaClient,
  learnerDeck: LearnerDeck,
  { sessionType, studyMode, direction }: SessionChoice,
) {
  const deck = { ...learnerDeck, direction };
  const [{ dueCount, newCount }, candidates, next] = await Promise.all([
    countDueAndNewCards(prisma, deck),
    findQueueCandidates(prisma, deck, { studyMode }),
    prisma.cardProgress.findFirst({
      where: {
        ...deck,
        lifecycleState: { in: ['LEARNING', 'REINFORCING'] },
        dueAt: { gt: new Date() },
      },
      orderBy: { dueAt: 'asc' },
      select: { dueAt: true },
    }),
  ]);
  return {
    // Its order varies with the seed, never its size
    sessionSize: composeQueue({
      candidates,
      sessionType,
      studyMode,
      seed: 0,
    }).length,
    dueCount,
    newCount,
    nextDueAt: next?.dueAt ?? null,
  };
}

/**
 * Abandons the learner's unfinished Study Sessions on a deck that are too
 * old to resume, ending each at its last activity. Their queues are left
 * as they were (`updated-plan.md` §12.4).
 */
async function abandonStaleSessions(
  prisma: PrismaClient,
  { userId, deckId }: LearnerDeck,
  cutoff: Date,
) {
  const stale = await prisma.studySession.findMany({
    where: { userId, deckId, status: 'ACTIVE', updatedAt: { lt: cutoff } },
    select: { id: true, updatedAt: true },
  });
  for (const { id, updatedAt } of stale) {
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

  try {
    return await prisma.studySession.create({
      data: {
        userId,
        deckId,
        sessionType,
        studyMode,
        direction,
        items: {
          create: queue.map((cardId, position) => ({ cardId, position })),
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

/**
 * Brings a missed card back at the end of its session, after every card
 * and earlier Retry, at most MAX_RETRIES times. Returns the new item, or
 * null once the card has come back as often as it may.
 */
async function queueRetry(
  tx: Prisma.TransactionClient,
  { studySessionId, cardId }: { studySessionId: string; cardId: string },
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
      card: { include: withCanonicalAnswers },
      studySession: {
        select: {
          status: true,
          direction: true,
          deck: { select: { archivedAt: true, reversible: true } },
        },
      },
    },
  });
  if (!item) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Study session card not found',
    });
  }
  // A session started before its deck was archived
  assertDeckActive(item.studySession.deck);
  if (item.studySession.status !== 'ACTIVE') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Session already finished',
    });
  }
  const { direction } = item.studySession;
  // A Reverse session on a deck turned one-way meanwhile
  assertStudiesIn(item.studySession.deck, direction);

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
  const progressKey = {
    userId_cardId_direction: { userId, cardId: item.cardId, direction },
  };

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

    if (!item.isRetry) {
      const progress = await tx.cardProgress.findUniqueOrThrow({
        where: progressKey,
      });
      const earlier = await findCountedAnswers(tx, {
        userId,
        cardId: item.cardId,
        direction,
        resetAt: progress.resetAt,
        exceptAttemptId: attempt.id,
      });
      await tx.cardProgress.update({
        where: progressKey,
        data: applyAnswer(progress, toScheduledAnswer(attempt), earlier),
      });
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
  const progressKey = {
    userId_cardId_direction: { userId, cardId: attempt.cardId, direction },
  };
  const { resetAt, markedKnownAt } =
    await prisma.cardProgress.findUniqueOrThrow({ where: progressKey });
  // It answered what was effectively a different card
  if (!countsSinceReset(attempt.createdAt, resetAt)) {
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

    await tx.cardProgress.update({
      where: progressKey,
      data: replayAnswers(
        await findCountedAnswers(tx, {
          userId,
          cardId: attempt.cardId,
          direction,
          resetAt,
        }),
        markedKnownAt,
      ),
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
