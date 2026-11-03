import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';

type DeckStats = inferRouterOutputs<AppRouter>['stats']['deckStats'];

/** Where one Study Direction of a card is in its life (`GLOSSARY.md`). */
export type LifecycleState = keyof DeckStats['lifecycle'];

/** How well the scheduler takes a card to be known, in four bands. */
export type MasteryBand = keyof DeckStats['bands'];

/** A card's Lifecycle State in plain words; never its mastery score. */
export const lifecycleLabels: Record<LifecycleState, string> = {
  NEW: 'New',
  LEARNING: 'Still learning',
  REINFORCING: 'Reinforcing',
  RETIRED: 'Retired',
};

/** The Lifecycle States in the order a card moves through them. */
export const LIFECYCLE_STATES = Object.keys(
  lifecycleLabels,
) as LifecycleState[];

/** A Mastery Band in plain words. */
export const masteryBandLabels: Record<MasteryBand, string> = {
  fragile: 'Fragile',
  developing: 'Developing',
  solid: 'Solid',
  mastered: 'Mastered',
};

/** The Mastery Bands, weakest first. */
export const MASTERY_BANDS = Object.keys(masteryBandLabels) as MasteryBand[];
