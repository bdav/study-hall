import { Link } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { formatUsd } from '@/lib/format';

/**
 * This month's AI spend against the monthly cap, for learners who can use
 * AI. The spend is every learner's, since that's what the cap measures.
 */
export function AiSpendSummary() {
  const me = trpc.auth.me.useQuery();
  const canUseAI = Boolean(me.data?.user?.canUseAI);
  const summary = trpc.aiUsage.summary.useQuery(undefined, {
    enabled: canUseAI,
  });

  if (!canUseAI || !summary.data) {
    return null;
  }

  const { spentUsd, capUsd, paused } = summary.data;

  return (
    <div className="mt-4 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          AI this month: {formatUsd(spentUsd)} of {formatUsd(capUsd)}
        </p>
        <Link
          to="/ai-usage"
          className="text-white/70 underline underline-offset-2 hover:text-white"
        >
          See AI usage
        </Link>
      </div>
      {paused && (
        <p className="mt-1 text-amber-200">
          AI features are paused until next month because the spending cap has
          been reached. Your existing courses still work.
        </p>
      )}
    </div>
  );
}
