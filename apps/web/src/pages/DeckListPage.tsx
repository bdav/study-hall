import { useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Archive,
  ChevronRight,
  CornerDownLeft,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { CenteredPage } from '@/components/CenteredPage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DeckListSkeleton } from '@/components/PageSkeleton';
import { DeckCard } from '@/components/DeckCard';
import { formatDate, formatPercent } from '@/lib/format';
import { archiveDeckDescription, canArchiveDeck } from '@/lib/decks';

const MotionLink = motion.create(Link);

type ArchivedDeck = {
  id: string;
  name: string;
  cardCount: number;
  archivedAt: Date | string | null;
  course: { title: string } | null;
};

/**
 * Archived decks, out of the way below the active ones: collapsed to
 * start, each restorable, or deletable for good after a confirmation.
 */
function ArchivedDecks({ archived }: { archived: ArchivedDeck[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const utils = trpc.useUtils();

  function refresh() {
    utils.deck.list.invalidate();
    utils.deck.listArchived.invalidate();
  }

  const restore = trpc.deck.restore.useMutation({
    onSuccess: () => {
      refresh();
      toast.success('Deck restored');
    },
    onError: () => toast.error('Failed to restore the deck'),
  });

  const deleteDeck = trpc.deck.delete.useMutation({
    onSuccess: () => {
      refresh();
      toast.success('Deck deleted');
    },
    onError: () => toast.error('Failed to delete the deck'),
  });

  if (archived.length === 0) return null;

  return (
    <section className="mt-10">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="archived-decks"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1 text-sm text-white/60 hover:text-white"
      >
        <ChevronRight
          className={`size-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          aria-hidden
        />
        Archived ({archived.length})
      </button>
      {/* Kept in the page while closed, so the toggle's aria-controls
          always points at it */}
      <ul
        id="archived-decks"
        aria-label="Archived decks"
        hidden={!isOpen}
        className="mt-3 space-y-2"
      >
        {archived.map((deck) => (
          <li
            key={deck.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/20 bg-white/5 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <Link
                to={`/decks/${deck.id}/cards`}
                className="font-medium break-words hover:underline"
              >
                {deck.name}
              </Link>
              <p className="text-xs text-white/50">
                {deck.course && <>Course: {deck.course.title} · </>}
                {deck.cardCount} {deck.cardCount === 1 ? 'card' : 'cards'}
                {deck.archivedAt && (
                  <> · Archived {formatDate(deck.archivedAt)}</>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label={`Restore ${deck.name}`}
                onClick={() => restore.mutate({ id: deck.id })}
                disabled={restore.isPending}
                className="text-sm text-white/70 hover:text-white disabled:opacity-50"
              >
                Restore
              </button>
              <ConfirmDialog
                title="Delete deck permanently"
                description={`Delete "${deck.name}" for good? Its ${deck.cardCount} ${deck.cardCount === 1 ? 'card' : 'cards'} and their whole history go with it: every answer, Card Version and Study Session. This can't be undone.`}
                confirmLabel="Delete permanently"
                onConfirm={() => deleteDeck.mutate({ id: deck.id })}
                trigger={
                  <button
                    type="button"
                    aria-label={`Delete ${deck.name} permanently`}
                    className="relative touch-target rounded p-1 text-white/40 transition-colors hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                }
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DeckListPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const utils = trpc.useUtils();
  const decksQuery = trpc.deck.list.useQuery();
  const archived = trpc.deck.listArchived.useQuery().data ?? [];

  const navigate = useNavigate();
  const createDeck = trpc.deck.create.useMutation({
    onSuccess: (data) => {
      utils.deck.list.invalidate();
      navigate(`/decks/${data.id}/cards`);
    },
    onError: () => {
      toast.error('Failed to create deck');
    },
  });

  const archiveDeck = trpc.deck.archive.useMutation({
    onSuccess: () => {
      utils.deck.list.invalidate();
      utils.deck.listArchived.invalidate();
      toast.success('Deck archived');
    },
    onError: () => {
      toast.error('Failed to archive the deck');
    },
  });

  if (decksQuery.isLoading) {
    return <DeckListSkeleton />;
  }

  if (decksQuery.isError) {
    return (
      <CenteredPage centered>
        <p className="text-destructive">Error loading decks.</p>
      </CenteredPage>
    );
  }

  const decks = decksQuery.data ?? [];

  return (
    <CenteredPage>
      <div className="w-full max-w-4xl text-white">
        <h1 className="text-2xl font-bold">Your Decks</h1>

        {decks.length === 0 && !isCreating ? (
          <p className="mt-6 text-white/60">
            {archived.length > 0
              ? 'No active decks. Create one, or restore one below.'
              : 'No decks yet. Create one to get started.'}
          </p>
        ) : null}

        <LayoutGroup>
          {/* One deck per row on phones */}
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {/* Create new deck card */}
            <AnimatePresence mode="popLayout" initial={false}>
              {isCreating ? (
                <motion.div
                  key="create-form"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                >
                  <DeckCard stackCount={0} wideOnPhones>
                    <button
                      type="button"
                      aria-label="Cancel"
                      className="absolute left-2 top-2 z-10 text-white/40 hover:text-white/70 transition-colors"
                      onClick={() => {
                        setIsCreating(false);
                        setNewDeckName('');
                      }}
                    >
                      <X className="size-4" />
                    </button>
                    <form
                      className="flex w-full flex-col items-center justify-center gap-1 px-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!newDeckName.trim()) return;
                        createDeck.mutate({ name: newDeckName.trim() });
                      }}
                    >
                      <span className="text-xs text-white/50">Deck name</span>
                      <div className="relative w-full">
                        <input
                          type="text"
                          value={newDeckName}
                          onChange={(e) => setNewDeckName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setIsCreating(false);
                              setNewDeckName('');
                            }
                          }}
                          autoFocus
                          className="w-full border-0 border-b-2 border-white/40 bg-transparent py-2 text-center text-lg font-bold tracking-wide text-white outline-none focus:border-white/60"
                        />
                        <Button
                          type="submit"
                          size="icon"
                          variant="ghost"
                          aria-label="Create deck"
                          disabled={createDeck.isPending || !newDeckName.trim()}
                          className={`absolute right-0 top-1/2 -translate-y-1/2 text-white/50 disabled:opacity-40 ${newDeckName.trim() ? 'animate-pulse-halo' : ''}`}
                        >
                          <CornerDownLeft className="size-5" />
                        </Button>
                      </div>
                    </form>
                  </DeckCard>
                </motion.div>
              ) : (
                <motion.div
                  key="new-deck-button"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                >
                  <DeckCard
                    stackCount={0}
                    wideOnPhones
                    className="cursor-pointer transition-shadow hover:shadow-lg"
                    onClick={() => setIsCreating(true)}
                  >
                    <Plus className="h-10 w-10 text-white/60" />
                    <p className="mt-2 text-sm font-medium text-white/60">
                      New Deck
                    </p>
                  </DeckCard>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Deck tiles */}
            {decks.map((deck) => (
              <MotionLink
                key={deck.id}
                layout="position"
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                to={`/decks/${deck.id}`}
                className="group/deck block transition-shadow hover:shadow-lg"
              >
                <DeckCard stackCount={Math.min(deck.cardCount, 3)} wideOnPhones>
                  <p className="text-center text-lg font-bold uppercase tracking-wide text-white">
                    {deck.name}
                  </p>
                  {deck.course && (
                    <p className="mt-0.5 text-center text-xs text-white/50">
                      Course: {deck.course.title}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-white/60">
                    {deck.cardCount} cards
                  </p>
                  {deck.totalAttempts > 0 && (
                    <p className="mt-2 text-sm font-medium text-white/80">
                      {formatPercent(deck.accuracy)}
                    </p>
                  )}
                  {deck.lastStudied && (
                    <p className="mt-0.5 text-xs text-white/50">
                      Last studied{' '}
                      {new Date(deck.lastStudied).toLocaleDateString()}
                    </p>
                  )}
                  {canArchiveDeck(deck) && (
                    <div
                      // Shown on hover, or always on touch screens, which have none
                      className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover/deck:opacity-100 pointer-coarse:opacity-100"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <ConfirmDialog
                        title="Archive deck"
                        description={archiveDeckDescription(deck.name)}
                        confirmLabel="Archive"
                        onConfirm={() => archiveDeck.mutate({ id: deck.id })}
                        trigger={
                          <button
                            type="button"
                            aria-label={`Archive ${deck.name}`}
                            className="relative touch-target rounded p-1 text-white/40 hover:text-white transition-colors"
                          >
                            <Archive className="size-4" />
                          </button>
                        }
                      />
                    </div>
                  )}
                </DeckCard>
              </MotionLink>
            ))}
          </div>
        </LayoutGroup>

        <ArchivedDecks archived={archived} />
      </div>
    </CenteredPage>
  );
}
