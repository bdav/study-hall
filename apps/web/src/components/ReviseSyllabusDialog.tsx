import { useId, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FeedbackChips } from '@/components/FeedbackChips';
import { PacingLine } from '@/components/PacingLine';
import { MAX_FEEDBACK_LENGTH } from '@/lib/feedback';
import {
  describeRound,
  REVISION_CHIP_GROUPS,
  type ApprovedRevision,
  type RefiningRevision,
  type RevisionChip,
  type RevisionRound,
  type SyllabusRevisionProposal,
} from '@/lib/syllabusRevision';
import {
  glassDialogClassName,
  glassInputClassName,
  tallDialogBodyClassName,
  tallDialogClassName,
  tallDialogFooterClassName,
} from '@/lib/utils';

type Lesson = { title: string; objectives: string[] };

/**
 * A proposed change as the learner has it: ticked or not, and an edit or a
 * new lesson as they've edited it, its objectives one to a line, with the
 * lesson as proposed.
 */
type Row = { selected: boolean } & (
  | {
      kind: 'EDIT';
      lessonId: string;
      before: Lesson;
      proposed: Lesson;
      title: string;
      objectives: string;
    }
  | {
      kind: 'ADD';
      afterLessonId: string | null;
      proposed: Lesson;
      title: string;
      objectives: string;
    }
  | { kind: 'ARCHIVE'; lessonId: string; title: string }
  | { kind: 'ORDER'; after: string[] }
);

function toRows(proposal: SyllabusRevisionProposal): Row[] {
  return [
    ...proposal.edits.map(
      (edit): Row => ({
        kind: 'EDIT',
        lessonId: edit.lessonId,
        before: edit.before,
        proposed: edit.after,
        title: edit.after.title,
        objectives: edit.after.objectives.join('\n'),
        selected: true,
      }),
    ),
    ...proposal.additions.map(
      (addition): Row => ({
        kind: 'ADD',
        afterLessonId: addition.afterLessonId,
        proposed: addition,
        title: addition.title,
        objectives: addition.objectives.join('\n'),
        selected: true,
      }),
    ),
    ...proposal.archives.map(
      (archive): Row => ({
        kind: 'ARCHIVE',
        lessonId: archive.lessonId,
        title: archive.title,
        selected: true,
      }),
    ),
    ...(proposal.order
      ? [{ kind: 'ORDER', after: proposal.order.after, selected: true } as Row]
      : []),
  ];
}

/** Objectives typed one to a line. */
function objectivesOf(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isComplete(row: Row) {
  return (
    (row.kind !== 'EDIT' && row.kind !== 'ADD') ||
    (row.title.trim() !== '' && objectivesOf(row.objectives).length > 0)
  );
}

/** What an edit changes, as typed; nothing when put back as it was. */
function editOf(row: Extract<Row, { kind: 'EDIT' }>) {
  const title = row.title.trim();
  const objectives = objectivesOf(row.objectives);
  return {
    lessonId: row.lessonId,
    ...(title !== row.before.title && { title }),
    ...(JSON.stringify(objectives) !==
      JSON.stringify(row.before.objectives) && {
      objectives,
    }),
  };
}

/** The ticked changes, as applying takes them. */
function approved(rows: Row[]): ApprovedRevision {
  const ticked = rows.filter((row) => row.selected);
  return {
    edits: ticked.flatMap((row) => {
      if (row.kind !== 'EDIT') return [];
      const edit = editOf(row);
      return 'title' in edit || 'objectives' in edit ? [edit] : [];
    }),
    archives: ticked.flatMap((row) =>
      row.kind === 'ARCHIVE' ? [row.lessonId] : [],
    ),
    additions: ticked.flatMap((row) =>
      row.kind === 'ADD'
        ? [
            {
              title: row.title.trim(),
              objectives: objectivesOf(row.objectives),
              afterLessonId: row.afterLessonId,
            },
          ]
        : [],
    ),
    order: ticked.find((row) => row.kind === 'ORDER')?.after ?? null,
  };
}

/**
 * A lesson as the learner left it, a field they blanked as it was proposed,
 * so an unticked change they cleared still tells the model what it was.
 */
function lessonAsLeft(row: {
  title: string;
  objectives: string;
  proposed: Lesson;
}) {
  const objectives = objectivesOf(row.objectives);
  return {
    title: row.title.trim() || row.proposed.title,
    objectives: objectives.length > 0 ? objectives : row.proposed.objectives,
  };
}

/** The proposal as the learner left it, for refining. */
function asLeft(rows: Row[]): RefiningRevision {
  const order = rows.find((row) => row.kind === 'ORDER');
  return {
    edits: rows.flatMap((row) =>
      row.kind === 'EDIT'
        ? [
            {
              lessonId: row.lessonId,
              ...lessonAsLeft(row),
              included: row.selected,
            },
          ]
        : [],
    ),
    archives: rows.flatMap((row) =>
      row.kind === 'ARCHIVE'
        ? [{ lessonId: row.lessonId, included: row.selected }]
        : [],
    ),
    additions: rows.flatMap((row) =>
      row.kind === 'ADD'
        ? [
            {
              ...lessonAsLeft(row),
              afterLessonId: row.afterLessonId,
              included: row.selected,
            },
          ]
        : [],
    ),
    order: order ? { lessonIds: order.after, included: order.selected } : null,
  };
}

/** A field in a change's After column, wrapping and growing with its text. */
function AfterField({
  label,
  value,
  onChange,
  rows = 1,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      aria-label={label}
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`field-sizing-content w-full resize-none px-2.5 py-1 text-base outline-none md:text-sm ${glassInputClassName}`}
    />
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-xs text-white/50">{children}</p>;
}

/**
 * The preview of a revision of an accepted Syllabus's lessons ahead: each
 * edit as before and after and each new lesson, editable, each archive,
 * and the new order as one change, every one tickable, with the pacing of
 * the lessons left now and with the ticked changes. Nothing changes until
 * the learner applies them. Refine proposes again from another round of
 * chips and words; a new proposal comes with a new dialog, so the parent
 * keys it by round.
 */
export function ReviseSyllabusDialog({
  open,
  onClose,
  onConfirm,
  onRefine,
  isPending,
  isRefining,
  refineError,
  rounds,
  proposal,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (revision: ApprovedRevision) => void;
  /** Proposes again from another round and the proposal as left. */
  onRefine: (round: RevisionRound, proposal: RefiningRevision) => void;
  isPending: boolean;
  isRefining: boolean;
  /** Why the last round of refining failed, if it did. */
  refineError: string | null;
  /** The learner's rounds of feedback so far, oldest first. */
  rounds: RevisionRound[];
  proposal: SyllabusRevisionProposal;
}) {
  const roundsId = useId();
  const [rows, setRows] = useState(() => toRows(proposal));
  const [isRefineOpen, setIsRefineOpen] = useState(false);
  const [chips, setChips] = useState<RevisionChip[]>([]);
  const [words, setWords] = useState('');

  const titles = new Map(proposal.lessons.map(({ id, title }) => [id, title]));
  // Lessons the ticked changes archive: out of the new order, and a new
  // lesson placed after one takes its place
  const archiving = new Set(
    rows.flatMap((row) =>
      row.kind === 'ARCHIVE' && row.selected ? [row.lessonId] : [],
    ),
  );
  const ticked = rows.filter((row) => row.selected);
  const complete = ticked.every(isComplete);
  const revision = approved(rows);
  const changesSomething =
    revision.edits.length +
      revision.archives.length +
      revision.additions.length >
      0 || revision.order !== null;
  const isBusy = isPending || isRefining;

  const pacingAt = (lessons: number) =>
    proposal.pacing?.byLessonsLeft.find((line) => line.lessons === lessons);
  const lessonsLeft = proposal.pacing?.lessonsLeft ?? 0;
  const pacingNow = pacingAt(lessonsLeft);
  const pacingAfter = pacingAt(
    lessonsLeft - revision.archives.length + revision.additions.length,
  );

  function update(index: number, change: Partial<Row>) {
    setRows((current) =>
      current.map((row, i) =>
        i === index ? ({ ...row, ...change } as Row) : row,
      ),
    );
  }

  function describe(row: Row, n: number): ReactNode {
    switch (row.kind) {
      case 'EDIT':
        return (
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 text-sm">
              <Caption>Before</Caption>
              <p className="break-words text-white/80">{row.before.title}</p>
              <ul className="mt-1 space-y-0.5 text-white/60">
                {row.before.objectives.map((objective) => (
                  <li key={objective} className="break-words">
                    {objective}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0 space-y-1">
              <Caption>After</Caption>
              <AfterField
                label={`Change ${n} title`}
                value={row.title}
                onChange={(title) => update(n - 1, { title })}
              />
              <AfterField
                label={`Change ${n} objectives`}
                value={row.objectives}
                onChange={(objectives) => update(n - 1, { objectives })}
                rows={2}
              />
            </div>
          </div>
        );
      case 'ADD':
        return (
          <div className="min-w-0 flex-1 space-y-1">
            <Caption>
              {row.afterLessonId === null
                ? 'New lesson at the start'
                : `New lesson ${archiving.has(row.afterLessonId) ? 'in place of' : 'after'} ${titles.get(row.afterLessonId) ?? 'a lesson'}`}
            </Caption>
            <AfterField
              label={`Change ${n} title`}
              value={row.title}
              onChange={(title) => update(n - 1, { title })}
            />
            <AfterField
              label={`Change ${n} objectives`}
              value={row.objectives}
              onChange={(objectives) => update(n - 1, { objectives })}
              rows={2}
            />
            <p className="text-xs text-white/50">One objective to a line.</p>
          </div>
        );
      case 'ARCHIVE':
        return (
          <div className="min-w-0 flex-1 text-sm">
            <p className="break-words text-white/80">Archive {row.title}</p>
            <p className="text-xs text-white/50">
              It leaves the syllabus, and can be restored.
            </p>
          </div>
        );
      case 'ORDER':
        return (
          <div className="min-w-0 flex-1 text-sm">
            <Caption>New order</Caption>
            <ol
              aria-label="New order"
              className="list-decimal space-y-0.5 pl-5 text-white/80"
            >
              {row.after
                .filter((id) => !archiving.has(id))
                .map((id) => (
                  <li key={id}>{titles.get(id)}</li>
                ))}
            </ol>
          </div>
        );
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className={`sm:max-w-2xl ${tallDialogClassName} ${glassDialogClassName}`}
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Revise syllabus</DialogTitle>
          <DialogDescription className="text-white/70">
            Changes to the lessons you haven&apos;t started. Untick the ones you
            don&apos;t want, or edit them first. Nothing changes until you apply
            them.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm">
          <p id={roundsId} className="text-xs text-white/50">
            You asked for
          </p>
          <ol
            aria-labelledby={roundsId}
            className={`space-y-1 text-white/80 ${rounds.length > 1 ? 'list-decimal pl-5' : ''}`}
          >
            {rounds.map((round, i) => (
              <li key={i} className="whitespace-pre-wrap break-words">
                {describeRound(round)}
              </li>
            ))}
          </ol>
        </div>
        {proposal.note && (
          <p className="text-sm text-white/80">{proposal.note}</p>
        )}

        <div className={`space-y-3 py-2 ${tallDialogBodyClassName}`}>
          <ol className="space-y-3">
            {rows.map((row, i) => (
              <li
                key={i}
                data-testid="syllabus-change"
                className="flex gap-3 rounded-lg border border-white/15 bg-white/5 p-3"
              >
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={(e) => update(i, { selected: e.target.checked })}
                  aria-label={`Include change ${i + 1}`}
                  className="mt-1 size-4 shrink-0 accent-white"
                />
                {describe(row, i + 1)}
              </li>
            ))}
          </ol>
          {rows.length === 0 && !proposal.note && (
            <p className="py-4 text-center text-sm text-white/70">
              No lessons need changing.
            </p>
          )}
          {pacingNow && pacingAfter && (
            <div className="space-y-2 rounded-lg border border-white/15 px-3 py-2">
              <div>
                <Caption>Now</Caption>
                <div aria-label="Now">
                  <PacingLine pacing={pacingNow} />
                </div>
              </div>
              <div>
                <Caption>With these changes</Caption>
                <div aria-label="With these changes">
                  <PacingLine pacing={pacingAfter} />
                </div>
              </div>
            </div>
          )}
        </div>

        {isRefineOpen && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = words.trim();
              if (chips.length === 0 && !text) return;
              onRefine({ chips, text: text || null }, asLeft(rows));
            }}
            className="space-y-2"
          >
            <FeedbackChips
              groups={REVISION_CHIP_GROUPS}
              chosen={chips}
              onChange={setChips}
              disabled={isBusy}
            />
            <textarea
              aria-label="In your own words"
              value={words}
              onChange={(e) => setWords(e.target.value)}
              maxLength={MAX_FEEDBACK_LENGTH}
              rows={2}
              placeholder="Say what to change about these changes"
              className={`w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassInputClassName}`}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-destructive">{refineError}</p>
              <Button
                type="submit"
                disabled={
                  (chips.length === 0 && !words.trim()) || !complete || isBusy
                }
                className="shrink-0 bg-white/20 text-white hover:bg-white/30"
              >
                {isRefining && <Loader2 className="size-4 animate-spin" />}
                {isRefining ? 'Proposing again…' : 'Propose again'}
              </Button>
            </div>
          </form>
        )}

        <DialogFooter
          className={`border-white/20 bg-white/5 ${tallDialogFooterClassName}`}
        >
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isBusy}
            className="border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsRefineOpen((isOpen) => !isOpen)}
            aria-expanded={isRefineOpen}
            disabled={isBusy}
            className="border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            Refine
          </Button>
          <Button
            onClick={() => onConfirm(revision)}
            disabled={!changesSomething || !complete || isBusy}
            className="bg-white/20 text-white hover:bg-white/30"
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {isPending ? 'Applying…' : 'Apply changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
