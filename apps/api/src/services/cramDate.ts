import { type Prisma } from '@prisma/client';

/*
 * A deck's Cram Date (GLOSSARY.md), the day Cram paces it toward (#87). It
 * is a date with no time, stored as the start of its day in UTC, and runs
 * to the end of that day. It changes only which cards Cram offers: answers
 * are scheduled as ever.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The moment a Cram Date has passed: the end of its day, in UTC. */
const endOf = (cramDate: Date) => cramDate.getTime() + DAY_MS;

/** A deck's Cram Date, or none once it has passed. */
export function liveCramDate(cramDate: Date | null, now: Date) {
  return cramDate && now.getTime() < endOf(cramDate) ? cramDate : null;
}

/**
 * When a card in review comes due in Cram (§17, the earlier of its due time
 * and Cram's): once half its interval has passed, or, with a Cram Date, once
 * the time since its interval began, its last review or mark known, reaches
 * half the days left, if that's sooner. The days left shrink as that time
 * grows, so they meet a third of the way from its start to the date's end: a
 * fixed time, however late it's asked. A card with no interval comes due at
 * its due time.
 */
export function cramDueAt(
  { dueAt, lastIntervalDays }: { dueAt: Date; lastIntervalDays: number | null },
  cramDate: Date | null,
) {
  if (lastIntervalDays === null) return dueAt;
  const interval = lastIntervalDays * DAY_MS;
  const halfInterval = dueAt.getTime() - interval / 2;
  if (!cramDate) return new Date(halfInterval);
  const start = dueAt.getTime() - interval;
  return new Date(
    Math.min(halfInterval, start + (endOf(cramDate) - start) / 3),
  );
}

/**
 * How many NEW cards a day introduce them all by a Cram Date, at one
 * session a day, today and the date included.
 */
export function cramNewPerDay(newCount: number, cramDate: Date, now: Date) {
  const daysLeft = Math.ceil((endOf(cramDate) - now.getTime()) / DAY_MS);
  return Math.ceil(newCount / daysLeft);
}

/**
 * How many NEW cards a day reach each deck's Cram Date, added up, given the
 * NEW cards; none without a date.
 */
export function newPerDayByDates(
  cramDates: Map<string, Date>,
  newCards: { deckId: string }[],
  now: Date,
) {
  if (cramDates.size === 0) return null;
  return [...cramDates].reduce(
    (sum, [deckId, cramDate]) =>
      sum +
      cramNewPerDay(
        newCards.filter((card) => card.deckId === deckId).length,
        cramDate,
        now,
      ),
    0,
  );
}

/** The Cram Dates still to come of a learner's decks, by deck. */
export async function readCramDates(
  prisma: Prisma.TransactionClient,
  deckIds: string[],
  now: Date,
) {
  const decks = await prisma.deck.findMany({
    where: { id: { in: deckIds }, cramUntil: { not: null } },
    select: { id: true, cramUntil: true },
  });
  return new Map(
    decks.flatMap(({ id, cramUntil }) => {
      const cramDate = liveCramDate(cramUntil, now);
      return cramDate ? [[id, cramDate] as const] : [];
    }),
  );
}
