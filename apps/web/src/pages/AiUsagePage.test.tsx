import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AiUsagePage from './AiUsagePage';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    aiUsage: { report: { useQuery: vi.fn() } },
  },
}));

type ReportQuery = ReturnType<typeof trpc.aiUsage.report.useQuery>;

const report = {
  month: '2026-10',
  totalUsd: 0.756,
  breakdown: [
    {
      purpose: 'SYLLABUS_GENERATION' as const,
      model: 'claude-opus-5-5',
      calls: 1,
      inputTokens: 100_000,
      outputTokens: 10_000,
      costUsd: 0.6,
    },
    {
      purpose: 'SYLLABUS_GENERATION' as const,
      model: 'claude-sonnet-5-5',
      calls: 2,
      inputTokens: 3_000,
      outputTokens: 15_000,
      costUsd: 0.156,
    },
  ],
  previousMonths: [
    { month: '2026-09', costUsd: 0.5 },
    { month: '2026-07', costUsd: 0.2 },
  ],
};

function renderPage(query: Partial<ReportQuery>) {
  vi.mocked(trpc.aiUsage.report.useQuery).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    ...query,
  } as ReportQuery);

  return render(
    <MemoryRouter>
      <AiUsagePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AiUsagePage', () => {
  it('breaks this month down by purpose and model', () => {
    renderPage({ data: report } as Partial<ReportQuery>);

    const thisMonth = screen.getByRole('table', { name: 'October 2026' });
    const rows = within(thisMonth).getAllByRole('row');
    expect(rows[1]).toHaveTextContent(
      /Syllabus generation\s*claude-opus-5-5\s*1\s*100,000\s*10,000\s*\$0\.60/,
    );
    expect(rows[2]).toHaveTextContent(
      /Syllabus generation\s*claude-sonnet-5-5\s*2\s*3,000\s*15,000\s*\$0\.16/,
    );
    expect(
      screen.getByText(/october 2026 total: \$0\.76/i),
    ).toBeInTheDocument();
  });

  it('shows the total for each previous month', () => {
    renderPage({ data: report } as Partial<ReportQuery>);

    const previous = screen.getByRole('table', { name: 'Previous months' });
    const rows = within(previous).getAllByRole('row');
    expect(rows[1]).toHaveTextContent(/September 2026\s*\$0\.50/);
    expect(rows[2]).toHaveTextContent(/July 2026\s*\$0\.20/);
  });

  it('says the figures are only the learner’s own usage', () => {
    renderPage({ data: report } as Partial<ReportQuery>);

    expect(screen.getByText(/only your own/i)).toBeInTheDocument();
  });

  it('shows an empty state before any AI usage', () => {
    renderPage({
      data: {
        month: '2026-10',
        totalUsd: 0,
        breakdown: [],
        previousMonths: [],
      },
    } as Partial<ReportQuery>);

    expect(screen.getByText(/no ai usage yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('notes a quiet month while still showing previous months', () => {
    renderPage({
      data: { ...report, totalUsd: 0, breakdown: [] },
    } as Partial<ReportQuery>);

    expect(screen.getByText(/no ai usage this month/i)).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'Previous months' }),
    ).toBeInTheDocument();
  });

  it('shows a loading state', () => {
    renderPage({ isLoading: true });

    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();
  });

  it('shows an error state', () => {
    renderPage({ isError: true });

    expect(screen.getByText(/error loading ai usage/i)).toBeInTheDocument();
  });
});
