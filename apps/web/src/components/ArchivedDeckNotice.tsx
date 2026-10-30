import { toast } from 'sonner';
import { Archive } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { formatDate } from '@/lib/format';

/**
 * On an archived deck's pages, which are read only (#77): says so, and
 * restores the deck, without a confirmation, as archiving again undoes it.
 */
export function ArchivedDeckNotice({
  deckId,
  archivedAt,
}: {
  deckId: string;
  archivedAt: Date | string;
}) {
  const utils = trpc.useUtils();
  const restore = trpc.deck.restore.useMutation({
    onSuccess: () => {
      utils.deck.getById.invalidate({ id: deckId });
      utils.deck.list.invalidate();
      utils.deck.listArchived.invalidate();
      toast.success('Deck restored');
    },
    onError: () => toast.error('Failed to restore the deck'),
  });

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white/80">
      <Archive className="size-4 shrink-0 text-white/60" aria-hidden />
      <p className="min-w-0 flex-1">
        This deck is archived, since {formatDate(archivedAt)}. Its cards and
        their history are kept: restore it to study or change it.
      </p>
      <button
        type="button"
        onClick={() => restore.mutate({ id: deckId })}
        disabled={restore.isPending}
        className="rounded-lg bg-white/20 px-3 py-1.5 font-medium text-white hover:bg-white/30 disabled:opacity-50"
      >
        Restore deck
      </button>
    </div>
  );
}
