import { aiAccessProcedure, protectedProcedure, router } from './trpc.js';
import { aiSpendStatus } from '../ai/spend.js';
import { aiUsageReport } from '../ai/usageReport.js';

export const aiUsageRouter = router({
  summary: aiAccessProcedure.query(({ ctx }) => aiSpendStatus(ctx.prisma)),

  report: protectedProcedure.query(({ ctx }) =>
    aiUsageReport(ctx.prisma, ctx.userId),
  ),
});
