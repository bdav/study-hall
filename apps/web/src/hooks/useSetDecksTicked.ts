import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';

/**
 * Saves which decks Today's Review takes (#115), showing the change at once
 * and putting it back should saving fail; what a review would hold follows,
 * kept from deciding anything (Start among it) until it's looked at again.
 */
export function useSetDecksTicked() {
  const utils = trpc.useUtils();
  return trpc.today.setDecksTicked.useMutation({
    onMutate: async ({ deckIds, ticked }) => {
      await utils.today.get.cancel();
      const before = utils.today.get.getData();
      utils.today.get.setData(
        undefined,
        (today) =>
          today && {
            ...today,
            review: {
              ...today.review,
              decks: today.review.decks.map((deck) =>
                deckIds.includes(deck.id) ? { ...deck, ticked } : deck,
              ),
            },
          },
      );
      return { before };
    },
    onError: (_error, _input, context) => {
      utils.today.get.setData(undefined, context?.before);
      toast.error("Couldn't save which decks to review. Try again.");
    },
    onSettled: () => {
      utils.today.get.invalidate();
      utils.study.reviewPreview.invalidate();
    },
  });
}
