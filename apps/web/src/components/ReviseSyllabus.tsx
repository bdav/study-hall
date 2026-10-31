import { useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { FeedbackChips } from '@/components/FeedbackChips';
import { ReviseSyllabusDialog } from '@/components/ReviseSyllabusDialog';
import { MAX_FEEDBACK_LENGTH } from '@/lib/feedback';
import {
  REVISION_CHIP_GROUPS,
  type RefiningRevision,
  type RevisionChip,
  type RevisionRound,
  type SyllabusRevisionProposal,
} from '@/lib/syllabusRevision';
import { glassInputClassName } from '@/lib/utils';

/** The latest proposal and every round of feedback it came from. */
interface Revision {
  rounds: RevisionRound[];
  proposal: SyllabusRevisionProposal;
}

/**
 * "Ask for changes" below a Syllabus being edited, for learners who can use
 * AI: chips and their own words propose changes to the lessons they haven't
 * started, which they review, refine as often as they like, and apply. The
 * latest proposal is kept here, not in the mutation, so a round in flight or
 * failed leaves it.
 */
export function ReviseSyllabus({ courseId }: { courseId: string }) {
  const headingId = useId();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const [chips, setChips] = useState<RevisionChip[]>([]);
  const [words, setWords] = useState('');
  const [revision, setRevision] = useState<Revision | null>(null);

  const propose = trpc.course.proposeSyllabusRevision.useMutation();
  const apply = trpc.course.applySyllabusRevision.useMutation({
    onSuccess: async () => {
      setRevision(null);
      setChips([]);
      setWords('');
      propose.reset();
      await Promise.all([
        utils.course.getById.invalidate({ id: courseId }),
        utils.course.listArchivedLessons.invalidate({ courseId }),
      ]);
      toast.success('Revised the syllabus');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  if (!me.data?.user?.canUseAI) return null;

  const text = words.trim();
  const canAsk = chips.length > 0 || text !== '';

  /** Asks for a proposal from a round, refining the current one if any. */
  function ask(round: RevisionRound, refining?: RefiningRevision) {
    const rounds = revision?.rounds ?? [];
    propose.mutate(
      {
        courseId,
        chips: round.chips,
        ...(round.text && { feedback: round.text }),
        ...(refining && { refining: { rounds, proposal: refining } }),
      },
      {
        onSuccess: (proposal) =>
          setRevision({ rounds: [...rounds, round], proposal }),
      },
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (canAsk) ask({ chips, text: text || null });
  }

  function closePreview() {
    setRevision(null);
    // Escape still closes while proposing again: this drops that round,
    // so it can't reopen the preview
    propose.reset();
  }

  return (
    <section
      aria-labelledby={headingId}
      className="mt-6 rounded-xl border border-white/20 bg-white/5 p-4"
    >
      <h3 id={headingId} className="font-semibold">
        Ask for changes
      </h3>
      <p className="mt-1 text-sm text-white/60">
        Changes to the lessons you haven&apos;t started. You&apos;ll see every
        change before anything changes.
      </p>
      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <FeedbackChips
          groups={REVISION_CHIP_GROUPS}
          chosen={chips}
          onChange={setChips}
          disabled={propose.isPending}
        />
        <textarea
          aria-label="In your own words"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          maxLength={MAX_FEEDBACK_LENGTH}
          rows={2}
          disabled={propose.isPending}
          placeholder="Such as: my exam moved up, so trim the rest"
          className={`w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassInputClassName}`}
        />
        {propose.error && !revision && (
          <p role="alert" className="text-sm text-red-400">
            {propose.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={!canAsk || propose.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-white hover:bg-white/30 disabled:opacity-50"
        >
          {propose.isPending && !revision && (
            <Loader2 className="size-4 animate-spin" />
          )}
          {propose.isPending && !revision
            ? 'Proposing changes…'
            : 'Propose changes'}
        </button>
      </form>

      {revision && (
        <ReviseSyllabusDialog
          // Each round's proposal starts the preview afresh
          key={revision.rounds.length}
          open
          onClose={closePreview}
          onConfirm={(approved) => apply.mutate({ courseId, ...approved })}
          onRefine={ask}
          isPending={apply.isPending}
          isRefining={propose.isPending}
          refineError={propose.error?.message ?? null}
          rounds={revision.rounds}
          proposal={revision.proposal}
        />
      )}
    </section>
  );
}
