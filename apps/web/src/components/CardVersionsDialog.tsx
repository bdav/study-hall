import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { answeredLine, formatDay } from '@/lib/format';
import { glassDialogClassName } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const blockClassName =
  'rounded-lg border border-white/20 bg-white/5 p-3 text-sm text-white/80';

/**
 * A card's version history, from its tile on the Cards tab (#54): each Card
 * Version, newest first, with when it started and ended, what it asked (its
 * front and each answer with its Accepted Variants), how many times it was
 * answered and how many were right, whether a revision of the deck started
 * it or it restored an earlier one; then the answers from before versions
 * were recorded. An earlier version that asks something else can be
 * restored, after a confirmation, as a new version.
 */
export function CardVersionsDialog({
  deckId,
  cardId,
  onClose,
}: {
  deckId: string;
  cardId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const query = trpc.card.history.useQuery({ cardId });
  const history = query.data;
  // The version last chosen to restore, kept while its confirmation closes
  const [restoring, setRestoring] = useState<{
    id: string;
    number: number;
  } | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const restore = trpc.card.restoreVersion.useMutation({
    onSuccess: (_, { versionId }) => {
      utils.card.listByDeck.invalidate({ deckId });
      utils.card.history.invalidate({ cardId });
      const restored = history?.versions.find((v) => v.id === versionId);
      toast.success(`Restored version ${restored?.number}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const latest = history?.versions[0];
  const first = history?.versions[history.versions.length - 1];

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className={`sm:max-w-lg max-h-[80vh] flex flex-col ${glassDialogClassName}`}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Card history</DialogTitle>
          <DialogDescription className="text-white/70">
            Each version of this card, newest first. A new version starts
            whenever an edit changes what the card asks.
          </DialogDescription>
        </DialogHeader>

        {query.isError && (
          <p className="text-sm text-white/60">
            Couldn&apos;t load this card&apos;s history.
          </p>
        )}
        {history && (
          <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1">
            {history.versions.map((version) => {
              const name = `Version ${version.number}${
                version.isCurrent ? ' (current)' : ''
              }`;
              return (
                <div
                  key={version.id}
                  role="group"
                  aria-label={name}
                  className={blockClassName}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-white">{name}</p>
                      <p className="text-xs text-white/50">
                        {version.endedAt
                          ? `${formatDay(version.startedAt)} – ${formatDay(version.endedAt)}`
                          : `Since ${formatDay(version.startedAt)}`}
                      </p>
                      {version.sourceModel && (
                        <p className="text-xs text-white/50">
                          From revising the deck
                        </p>
                      )}
                      {version.restoredFromNumber !== null && (
                        <p className="text-xs text-white/50">
                          Restored version {version.restoredFromNumber}
                        </p>
                      )}
                    </div>
                    {version.canRestore && (
                      <button
                        type="button"
                        onClick={() => {
                          setRestoring(version);
                          setIsConfirming(true);
                        }}
                        disabled={restore.isPending}
                        className="shrink-0 cursor-pointer rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20 disabled:cursor-default disabled:opacity-50"
                      >
                        Restore
                      </button>
                    )}
                  </div>

                  <div className="mt-2 rounded-md bg-white/10 p-2 text-center">
                    <p className="font-semibold uppercase tracking-wide text-white">
                      {version.front}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {version.canonicalAnswers.map((answer, i) => {
                        const variants = version.acceptedVariants?.[i] ?? [];
                        return (
                          <li key={answer}>
                            <p className="text-white">{answer}</p>
                            {variants.length > 0 && (
                              <p className="text-xs text-white/50">
                                Variants: {variants.join(', ')}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {version.acceptedVariants === null && (
                      <p className="mt-1 text-xs text-white/50">
                        Variants weren’t recorded for this version.
                      </p>
                    )}
                  </div>

                  <p className="mt-2 text-white/60">
                    {answeredLine(version.answeredCount, version.rightCount)}
                  </p>
                </div>
              );
            })}

            {history.unversioned && first && (
              <div
                role="group"
                aria-label={`Before version ${first.number}`}
                className={blockClassName}
              >
                <p className="font-medium text-white">
                  Before version {first.number}
                </p>
                <p className="mt-1 text-white/60">
                  {answeredLine(
                    history.unversioned.answeredCount,
                    history.unversioned.rightCount,
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        <ConfirmDialog
          open={isConfirming}
          onOpenChange={setIsConfirming}
          title={`Restore version ${restoring?.number}?`}
          description={`The card will ask what version ${restoring?.number} asked again, as version ${
            (latest?.number ?? 0) + 1
          }. Its progress will reset; your answers are kept.`}
          confirmLabel="Restore"
          onConfirm={() => {
            if (restoring) {
              restore.mutate({ cardId, versionId: restoring.id });
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
