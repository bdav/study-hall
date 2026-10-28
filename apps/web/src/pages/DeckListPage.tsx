import { useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CornerDownLeft, Plus, Trash2, X } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { CenteredPage } from '@/components/CenteredPage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DeckListSkeleton } from '@/components/PageSkeleton';
import { DeckCard } from '@/components/DeckCard';
import { formatPercent } from '@/lib/format';

const MotionLink = motion.create(Link);

export default function DeckListPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const utils = trpc.useUtils();
  const decksQuery = trpc.deck.list.useQuery();

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

  const deleteDeck = trpc.deck.delete.useMutation({
    onSuccess: () => {
      utils.deck.list.invalidate();
      toast.success('Deck deleted');
    },
    onError: () => {
      toast.error('Failed to delete deck');
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
            No decks yet. Create one to get started.
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
                      title="Delete deck"
                      description={`Are you sure you want to delete "${deck.name}"? This cannot be undone.`}
                      confirmLabel="Delete"
                      onConfirm={() => deleteDeck.mutate({ id: deck.id })}
                      trigger={
                        <button
                          type="button"
                          aria-label={`Delete ${deck.name}`}
                          className="relative touch-target rounded p-1 text-white/40 hover:text-destructive transition-colors"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      }
                    />
                  </div>
                </DeckCard>
              </MotionLink>
            ))}
          </div>
        </LayoutGroup>
      </div>
    </CenteredPage>
  );
}
