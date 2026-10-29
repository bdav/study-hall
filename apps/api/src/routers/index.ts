import { publicProcedure, router } from './trpc.js';
import { aiUsageRouter } from './aiUsage.js';
import { authRouter } from './auth.js';
import { cardRouter } from './card.js';
import { courseRouter } from './course.js';
import { deckRouter } from './deck.js';
import { exerciseRouter } from './exercise.js';
import { lessonRouter } from './lesson.js';
import { studyRouter } from './study.js';
import { statsRouter } from './stats.js';
import { tutorRouter } from './tutor.js';

export { publicProcedure };

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return { ok: true };
  }),
  aiUsage: aiUsageRouter,
  auth: authRouter,
  card: cardRouter,
  course: courseRouter,
  deck: deckRouter,
  exercise: exerciseRouter,
  lesson: lessonRouter,
  study: studyRouter,
  stats: statsRouter,
  tutor: tutorRouter,
});
