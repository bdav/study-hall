import { aiAccessProcedure, protectedProcedure, router } from './trpc.js';
import { aiSpendStatus } from '../ai/spend.js';
import { aiUsageReport } from '../ai/usageReport.js';

export const aiUsageRouter = router({
  /** The signed-in learner's own spend this month against their cap. */
  summary: aiAccessProcedure.query(({ ctx }) =>
    aiSpendStatus(ctx.prisma, ctx.userId),
  ),

  report: protectedProcedure.query(({ ctx }) =>
    aiUsageReport(ctx.prisma, ctx.userId),
  ),
});
