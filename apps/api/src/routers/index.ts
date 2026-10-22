import { publicProcedure, router } from './trpc.js';
import { authRouter } from './auth.js';
import { cardRouter } from './card.js';
import { courseRouter } from './course.js';
import { deckRouter } from './deck.js';
import { studyRouter } from './study.js';
import { statsRouter } from './stats.js';

export { publicProcedure };

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return { ok: true };
  }),
  auth: authRouter,
  card: cardRouter,
  course: courseRouter,
  deck: deckRouter,
  study: studyRouter,
  stats: statsRouter,
});
