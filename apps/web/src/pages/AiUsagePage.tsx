import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { trpc } from '@/lib/trpc';
import { CenteredPage } from '@/components/CenteredPage';
import { StatsSkeleton } from '@/components/PageSkeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUsd } from '@/lib/format';

type AiPurpose =
  inferRouterOutputs<AppRouter>['aiUsage']['report']['breakdown'][number]['purpose'];

const PURPOSE_LABELS: Record<AiPurpose, string> = {
  SYLLABUS_GENERATION: 'Syllabus generation',
};

const monthFormat = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Names an AI month (`YYYY-MM`, in UTC), such as "October 2026". */
function formatMonth(month: string): string {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`));
}

function formatTokens(tokens: number): string {
  return tokens.toLocaleString('en-US');
}

export default function AiUsagePage() {
  const reportQuery = trpc.aiUsage.report.useQuery();

  if (reportQuery.isLoading) {
    return <StatsSkeleton />;
  }

  if (reportQuery.isError) {
    return (
      <CenteredPage centered>
        <p className="text-destructive">Error loading AI usage.</p>
      </CenteredPage>
    );
  }

  const report = reportQuery.data;

  if (!report) {
    return null;
  }

  if (report.breakdown.length === 0 && report.previousMonths.length === 0) {
    return (
      <CenteredPage centered>
        <h1 className="text-2xl font-bold text-white">AI usage</h1>
        <p className="mt-2 text-white/60">
          No AI usage yet. Creating a course uses AI, and its cost will show up
          here.
        </p>
      </CenteredPage>
    );
  }

  const monthName = formatMonth(report.month);

  return (
    <CenteredPage>
      <div className="w-full max-w-3xl text-white">
        <h1 className="text-2xl font-bold">AI usage</h1>
        <p className="mt-1 text-sm text-white/60">
          Estimated costs of only your own AI calls. The monthly spending cap
          counts every learner&apos;s.
        </p>

        <div className="mt-8">
          <h2 id="ai-usage-this-month" className="text-lg font-semibold">
            {monthName}
          </h2>
          {report.breakdown.length === 0 ? (
            <p className="mt-2 text-white/60">No AI usage this month.</p>
          ) : (
            <>
              <Table aria-labelledby="ai-usage-this-month" className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Input tokens</TableHead>
                    <TableHead className="text-right">Output tokens</TableHead>
                    <TableHead className="text-right">Est. cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.breakdown.map((row) => (
                    <TableRow key={`${row.purpose}:${row.model}`}>
                      <TableCell>{PURPOSE_LABELS[row.purpose]}</TableCell>
                      <TableCell>{row.model}</TableCell>
                      <TableCell className="text-right">{row.calls}</TableCell>
                      <TableCell className="text-right">
                        {formatTokens(row.inputTokens)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatTokens(row.outputTokens)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatUsd(row.costUsd)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-right text-sm font-medium">
                {monthName} total: {formatUsd(report.totalUsd)}
              </p>
            </>
          )}
        </div>

        {report.previousMonths.length > 0 && (
          <div className="mt-8">
            <h2 id="ai-usage-previous" className="text-lg font-semibold">
              Previous months
            </h2>
            <Table aria-labelledby="ai-usage-previous" className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.previousMonths.map(({ month, costUsd }) => (
                  <TableRow key={month}>
                    <TableCell>{formatMonth(month)}</TableCell>
                    <TableCell className="text-right">
                      {formatUsd(costUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </CenteredPage>
  );
}
