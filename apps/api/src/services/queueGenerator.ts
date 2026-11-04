import {
  type PrismaClient,
  type SessionType,
  type StudyDirection,
  type StudyMode,
} from '@prisma/client';
import {
  type CardStanding,
  readCardStanding,
  type Standings,
} from './cardStanding.js';

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
  // Retired cards, for Review retired alone (#86), in deck order
  retired: string[];
  // How many NEW cards a day reach the Cram Date, in Cram with one (#87)
  newPerDay?: number | null;
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
  retired: number;
};

const total = (counts: Counts) =>
  counts.learning +
  counts.weak +
  counts.reinforcing +
  counts.new +
  counts.retired;

/** The bucket each count draws from. */
const BUCKET_OF = {
  learning: 'dueLearning',
  weak: 'weakReinforcing',
  reinforcing: 'dueReinforcing',
  new: 'newCards',
  retired: 'retired',
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
      retired: 0,
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
    retired: 0,
  };
  return fillRoom(counts, candidates, max, ['learning', 'reinforcing', 'weak']);
}

/**
 * Cram (§16.3): NEW cards 40%, or as many as the Cram Date needs a day
 * (#87), up to the whole session, and weak cards a tenth of it or the room
 * left, then due LEARNING up to half and due REINFORCING up to 60%. Room left
 * goes to reviews, then to NEW cards, so a deck with nothing to review is
 * covered as fast as sessions allow.
 */
function cramCounts(candidates: QueueCandidates, { max }: Size): Counts {
  const newCount = Math.min(
    candidates.newCards.length,
    max,
    Math.max(Math.floor(max * CRAM_NEW_SHARE), candidates.newPerDay ?? 0),
  );
  const counts = withReviewCaps(
    {
      new: newCount,
      weak: Math.min(
        candidates.weakReinforcing.length,
        Math.floor(max * CRAM_WEAK_CAP),
        max - newCount,
      ),
      learning: 0,
      reinforcing: 0,
      retired: 0,
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
 * Review retired (#86): the retired cards alone, as many as the session
 * holds, a random sample of them when there are more (`composeQueue`).
 */
function reviewRetiredCounts(
  candidates: QueueCandidates,
  { max }: Size,
): Counts {
  return {
    learning: 0,
    weak: 0,
    reinforcing: 0,
    new: 0,
    retired: Math.min(candidates.retired.length, max),
  };
}

/**
 * What each Study Mode does differently in a session, all else, the
 * scheduler above all, being the same (§16): how it mixes a session, and
 * whether it takes weak cards before they're due and NEW cards at all.
 * Cram's counting cards due sooner is Card Standing's (`readCardStanding`).
 */
const MODE_RULES: Record<
  StudyMode,
  {
    counts: (candidates: QueueCandidates, size: Size) => Counts;
    weakBeforeDue: boolean;
    takesNew: boolean;
    takesRetired: boolean;
  }
> = {
  STUDY: {
    counts: studyCounts,
    weakBeforeDue: false,
    takesNew: true,
    takesRetired: false,
  },
  DRILL_WEAKEST: {
    counts: drillCounts,
    weakBeforeDue: true,
    takesNew: false,
    takesRetired: false,
  },
  CRAM: {
    counts: cramCounts,
    weakBeforeDue: false,
    takesNew: true,
    takesRetired: false,
  },
  REVIEW_RETIRED: {
    counts: reviewRetiredCounts,
    weakBeforeDue: false,
    takesNew: false,
    takesRetired: true,
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
      // A random sample of them, not the first in deck order
      ...shuffle(candidates.retired, seed).slice(0, counts.retired),
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

/** The most cards of a bucket any session could take. */
const MOST = Math.max(...Object.values(SESSION_SIZES).map(({ max }) => max));

/**
 * The cards a Study Session can draw from in a Study Mode, by bucket, from
 * their Card Standing in the session's deck and Study Direction, each as
 * long as the biggest session could use. Study and Cram take a Weak card
 * once it's due; Drill Weakest takes it before (§16.2) and takes no NEW
 * cards.
 */
export function queueCandidates(
  { cards, due, weak, newPerDay }: Standings,
  studyMode: StudyMode,
): QueueCandidates {
  const { weakBeforeDue, takesNew, takesRetired } = MODE_RULES[studyMode];
  const ids = (standings: CardStanding[]) =>
    standings.slice(0, MOST).map(({ cardId }) => cardId);
  return {
    dueLearning: ids(due.filter((card) => card.lifecycleState === 'LEARNING')),
    dueReinforcing: ids(
      due.filter(
        (card) => card.lifecycleState === 'REINFORCING' && !card.isWeak,
      ),
    ),
    weakReinforcing: ids(
      weakBeforeDue ? weak : weak.filter((card) => card.isDue),
    ),
    newCards: takesNew
      ? ids(cards.filter((card) => card.lifecycleState === 'NEW'))
      : [],
    // Every one, so a sample can come from any of them
    retired: takesRetired
      ? cards
          .filter((card) => card.lifecycleState === 'RETIRED')
          .map(({ cardId }) => cardId)
      : [],
    newPerDay,
  };
}

/**
 * The cards a learner's Study Session on a deck can draw from now in a
 * Study Mode and Study Direction (`queueCandidates`), read from their Card
 * Standing.
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
  return queueCandidates(
    await readCardStanding(prisma, {
      userId,
      deckIds: [deckId],
      direction,
      studyMode,
      now,
    }),
    studyMode,
  );
}
