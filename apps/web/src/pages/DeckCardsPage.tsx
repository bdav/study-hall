import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CornerDownLeft,
  Pencil,
  Plus,
  RefreshCw,
  SquareCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import {
  answersWithPrimary,
  markedKnownMessage,
  toFlashcard,
} from '@/lib/cards';
import { parseCsv } from '@/lib/csvParser';
import { diffCsvRows } from '@/lib/csvDiff';
import type { NewCard, UpdateCard, SkippedRow } from '@/lib/csvDiff';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ImportPreviewDialog } from '@/components/ImportPreviewDialog';
import { CenteredPage } from '@/components/CenteredPage';
import { DeckTabs } from '@/components/DeckTabs';
import { DeckCardsSkeleton } from '@/components/PageSkeleton';
import { DeckCard } from '@/components/DeckCard';
import { FlashCardTile } from '@/components/FlashCardTile';
import { CardAnswers } from '@/components/CardAnswers';
import { CardVersionsDialog } from '@/components/CardVersionsDialog';
import { ReviseCards } from '@/components/ReviseCards';
import {
  CardSelectionBar,
  SelectCardToggle,
} from '@/components/CardSelectionBar';

function EditableDeckTitle({ deckId, name }: { deckId: string; name: string }) {
  const utils = trpc.useUtils();
  const [localName, setLocalName] = useState(name);
  const [isEditing, setIsEditing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    setLocalName(name);
  }, [name]);

  const updateDeck = trpc.deck.update.useMutation({
    onSuccess: () => {
      utils.deck.getById.invalidate({ id: deckId });
      utils.deck.list.invalidate();
    },
    onError: () => {
      toast.error('Failed to update deck name');
      setLocalName(name);
    },
  });

  const mutateRef = useRef(updateDeck.mutate);
  useEffect(() => {
    mutateRef.current = updateDeck.mutate;
  }, [updateDeck.mutate]);

  function debouncedSave(newName: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const trimmed = newName.trim();
      if (trimmed && trimmed !== name) {
        mutateRef.current({ id: deckId, name: trimmed });
      }
    }, 800);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (!isEditing) {
    return (
      <div
        className="group flex cursor-text items-center gap-3"
        onClick={() => setIsEditing(true)}
        title="Click to edit"
      >
        <h1 className="text-3xl font-bold text-white group-hover:text-white/80">
          {localName}
        </h1>
        <Pencil className="h-5 w-5 text-white/40 group-hover:text-white/60" />
      </div>
    );
  }

  return (
    <input
      type="text"
      value={localName}
      onChange={(e) => {
        setLocalName(e.target.value);
        debouncedSave(e.target.value);
      }}
      onBlur={() => setIsEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          setIsEditing(false);
        }
      }}
      autoFocus
      className="w-full bg-transparent text-3xl font-bold text-white outline-none border-b-2 border-white/30 focus:border-white/60 transition-colors"
    />
  );
}

export default function DeckCardsPage() {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [isCreating, setIsCreating] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [hasVisitedBack, setHasVisitedBack] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [newFront, setNewFront] = useState('');
  const [newBack, setNewBack] = useState('');
  const [csvError, setCsvError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewNewCards, setPreviewNewCards] = useState<NewCard[]>([]);
  const [previewUpdateCards, setPreviewUpdateCards] = useState<UpdateCard[]>(
    [],
  );
  const [previewSkippedRows, setPreviewSkippedRows] = useState<SkippedRow[]>(
    [],
  );
  // The card whose answers are open below it
  const [answersCardId, setAnswersCardId] = useState<string | null>(null);
  // The card whose version history is open
  const [historyCardId, setHistoryCardId] = useState<string | null>(null);
  // The selected cards while selecting, none otherwise
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newCardButtonRef = useRef<HTMLDivElement | null>(null);
  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);

  const FLIP_DURATION_MS = 500;

  function flipToBack() {
    setIsFlipped(true);
    setHasVisitedBack(true);
    requestAnimationFrame(() =>
      setTimeout(() => backInputRef.current?.focus(), FLIP_DURATION_MS),
    );
  }

  function flipToFront() {
    setIsFlipped(false);
    requestAnimationFrame(() =>
      setTimeout(() => frontInputRef.current?.focus(), FLIP_DURATION_MS),
    );
  }

  const deckQuery = trpc.deck.getById.useQuery(
    { id: deckId! },
    { enabled: !!deckId },
  );

  const cardsQuery = trpc.card.listByDeck.useQuery(
    { deckId: deckId! },
    { enabled: !!deckId },
  );
  const me = trpc.auth.me.useQuery();
  const canUseAI = Boolean(me.data?.user?.canUseAI);

  const invalidateCards = () =>
    utils.card.listByDeck.invalidate({ deckId: deckId! });

  const createCard = trpc.card.create.useMutation({
    onSuccess: () => {
      invalidateCards();
      setIsCreating(false);
      setIsFlipped(false);
      setHasVisitedBack(false);
      setNewFront('');
      setNewBack('');
      toast.success('Card added');
      requestAnimationFrame(() => newCardButtonRef.current?.focus());
    },
    onError: () => {
      toast.error('Failed to add card');
    },
  });

  function cancelCreate() {
    setIsCreating(false);
    setIsFlipped(false);
    setHasVisitedBack(false);
    setNewFront('');
    setNewBack('');
  }

  const updateCard = trpc.card.update.useMutation({
    onSuccess: () => {
      invalidateCards();
    },
    onError: () => {
      toast.error('Failed to update card');
    },
  });

  const deleteCard = trpc.card.delete.useMutation({
    onSuccess: () => {
      invalidateCards();
    },
    onError: () => {
      toast.error('Failed to delete card');
    },
  });

  const markKnown = trpc.card.markKnown.useMutation({
    onSuccess: ({ markedCount }) => {
      invalidateCards();
      toast.success(markedKnownMessage(markedCount));
    },
    onError: () => {
      toast.error("Couldn't mark the card known");
    },
  });

  const deleteDeck = trpc.deck.delete.useMutation({
    onSuccess: () => {
      utils.deck.list.invalidate();
      toast.success('Deck deleted');
      navigate('/flashcards');
    },
    onError: () => {
      toast.error('Failed to delete deck');
    },
  });

  const importCards = trpc.card.importCards.useMutation({
    onSuccess: (data) => {
      invalidateCards();
      setPreviewOpen(false);
      setIsImporting(false);
      setCsvError(null);
      const parts: string[] = [];
      if (data.createdCount > 0) parts.push(`${data.createdCount} created`);
      if (data.updatedCount > 0) parts.push(`${data.updatedCount} updated`);
      toast.success(`Import complete: ${parts.join(', ')}`);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  if (!deckId) {
    return (
      <CenteredPage centered>
        <p className="text-destructive">No deck ID provided.</p>
      </CenteredPage>
    );
  }

  if (deckQuery.isLoading || cardsQuery.isLoading) {
    return <DeckCardsSkeleton />;
  }

  if (deckQuery.isError || !deckQuery.data) {
    return (
      <CenteredPage centered>
        <p className="text-destructive">Error loading deck.</p>
      </CenteredPage>
    );
  }

  const deck = deckQuery.data;
  const cards = (cardsQuery.data ?? []).map(toFlashcard);

  function handleCsvUpload(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const csvContent = e.target?.result as string;
      const parseResult = parseCsv(csvContent);

      if (parseResult.headerError) {
        setCsvError(parseResult.headerError);
        return;
      }

      const diff = diffCsvRows(
        parseResult.validRows,
        cards,
        parseResult.errorRows,
      );
      setPreviewNewCards(diff.newCards);
      setPreviewUpdateCards(diff.updateCards);
      setPreviewSkippedRows(diff.skippedRows);
      setPreviewOpen(true);
      setCsvError(null);
    };
    reader.readAsText(file);
  }

  function closePreview() {
    setPreviewOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  return (
    <CenteredPage>
      <div className="w-full max-w-4xl text-white">
        <div className="relative w-full max-w-4xl">
          <EditableDeckTitle deckId={deckId} name={deck.name} />
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            <DeckTabs deckId={deckId} activeTab="cards" />
          </div>
        </div>

        <p className="mt-2 text-sm text-white/50">
          {cards.length} {cards.length === 1 ? 'card' : 'cards'}
          {cards.length === 0 && (
            <span className="ml-1">
              — add cards below or import a CSV to get started
            </span>
          )}
        </p>

        {selection ? (
          <CardSelectionBar
            deckId={deckId}
            cardIds={cards.map((card) => card.id)}
            selected={selection}
            onSelect={setSelection}
            onDone={() => setSelection(null)}
          />
        ) : (
          <div className="flex justify-end gap-4 mr-4">
            {cards.length > 0 && (
              <button
                type="button"
                onClick={() => setSelection(new Set())}
                aria-label="Select cards"
                className="inline-flex items-center text-sm text-white/40 hover:text-white transition-colors"
              >
                <SquareCheck className="h-4 w-4 mr-1" />
                Select
              </button>
            )}
            {canUseAI && cards.length > 0 && <ReviseCards deckId={deckId} />}
            <ConfirmDialog
              title="Delete deck"
              description={`Are you sure you want to delete "${deck.name}"? This cannot be undone.`}
              confirmLabel="Delete"
              onConfirm={() => deleteDeck.mutate({ id: deckId })}
              trigger={
                <button
                  className="inline-flex items-center text-sm text-white/40 hover:text-destructive transition-colors"
                  title="Delete deck"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete Deck
                </button>
              }
            />
          </div>
        )}

        {/* Card Grid */}
        <LayoutGroup>
          <div className="mt-2 grid grid-cols-2 gap-6 sm:grid-cols-3">
            {/* New Card button / form */}
            <AnimatePresence mode="popLayout" initial={false}>
              {isCreating ? (
                <motion.div
                  key="create-form"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                  style={{ perspective: '600px' }}
                >
                  <div className="relative w-full rounded-b-xl rounded-t-3xl pt-3">
                    <div
                      className="relative w-full transition-transform duration-500"
                      style={{
                        transformStyle: 'preserve-3d',
                        transform: isFlipped
                          ? 'rotateY(-180deg)'
                          : 'rotateY(0deg)',
                      }}
                    >
                      {/* Front face — enter "front" text */}
                      <div
                        className="relative flex aspect-3/2 w-full flex-col items-center justify-center rounded-xl border border-white/30 bg-white/10 p-4 backdrop-blur-sm"
                        style={{ backfaceVisibility: 'hidden' }}
                      >
                        <button
                          type="button"
                          aria-label="Cancel"
                          className="absolute left-2 top-2 z-10 text-white/40 hover:text-white/70 transition-colors"
                          onClick={cancelCreate}
                        >
                          <X className="size-4" />
                        </button>
                        {hasVisitedBack && (
                          <button
                            type="button"
                            aria-label="Flip to back"
                            className="absolute right-2 top-2 z-10 text-white/40 hover:text-white/70 transition-colors"
                            onClick={flipToBack}
                          >
                            <RefreshCw className="size-4" />
                          </button>
                        )}
                        <span className="text-xs text-white/50">Front</span>
                        <div className="relative w-full">
                          <input
                            ref={frontInputRef}
                            type="text"
                            aria-label="Front"
                            value={newFront}
                            onChange={(e) => setNewFront(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                cancelCreate();
                              } else if (e.key === 'Enter' && newFront.trim()) {
                                flipToBack();
                              }
                            }}
                            autoFocus
                            className="w-full border-0 border-b-2 border-white/40 bg-transparent py-2 text-center text-lg font-bold tracking-wide text-white outline-none focus:border-white/60"
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label="Flip to back"
                            disabled={!newFront.trim()}
                            onClick={() => {
                              if (newFront.trim()) flipToBack();
                            }}
                            className={`absolute right-0 top-1/2 -translate-y-1/2 text-white/50 disabled:opacity-40 ${newFront.trim() ? 'animate-pulse-halo' : ''}`}
                          >
                            <CornerDownLeft className="size-5" />
                          </Button>
                        </div>
                      </div>

                      {/* Back face — enter "back" text */}
                      <div
                        className="absolute inset-0 flex aspect-3/2 w-full flex-col items-center justify-center rounded-xl border border-white/30 bg-white/15 p-4 backdrop-blur-sm"
                        style={{
                          backfaceVisibility: 'hidden',
                          transform: 'rotateY(-180deg)',
                        }}
                      >
                        <button
                          type="button"
                          aria-label="Cancel"
                          className="absolute left-2 top-2 z-10 text-white/40 hover:text-white/70 transition-colors"
                          onClick={cancelCreate}
                        >
                          <X className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Flip to front"
                          className="absolute right-2 top-2 z-10 text-white/40 hover:text-white/70 transition-colors"
                          onClick={flipToFront}
                        >
                          <RefreshCw className="size-4" />
                        </button>
                        <span className="text-xs text-white/50">Back</span>
                        <form
                          className="relative w-full"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!newFront.trim() || !newBack.trim()) return;
                            createCard.mutate({
                              deckId,
                              front: newFront.trim(),
                              canonicalAnswers: [newBack.trim()],
                            });
                          }}
                        >
                          <input
                            ref={backInputRef}
                            type="text"
                            aria-label="Back"
                            value={newBack}
                            onChange={(e) => setNewBack(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                cancelCreate();
                              }
                            }}
                            className="w-full border-0 border-b-2 border-white/40 bg-transparent py-2 text-center text-lg font-bold tracking-wide text-white outline-none focus:border-white/60"
                          />
                          <Button
                            type="submit"
                            size="icon"
                            variant="ghost"
                            aria-label="Create card"
                            disabled={
                              createCard.isPending ||
                              !newFront.trim() ||
                              !newBack.trim()
                            }
                            className={`absolute right-0 top-1/2 -translate-y-1/2 text-white/50 disabled:opacity-40 ${newBack.trim() ? 'animate-pulse-halo' : ''}`}
                          >
                            <CornerDownLeft className="size-5" />
                          </Button>
                        </form>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="new-card-button"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                >
                  <DeckCard
                    ref={newCardButtonRef}
                    stackCount={0}
                    autoFocus
                    className="group/new cursor-pointer transition-shadow hover:shadow-lg focus:outline-none"
                    onClick={() => setIsCreating(true)}
                  >
                    <Plus className="h-10 w-10 text-white/60 group-focus/new:animate-pulse-halo" />
                    <p className="mt-2 text-sm font-medium text-white/60 group-focus/new:animate-pulse-halo">
                      New Card
                    </p>
                  </DeckCard>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Import CSV tile */}
            <AnimatePresence mode="popLayout" initial={false}>
              {isImporting ? (
                <motion.div
                  key="import-form"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                >
                  <DeckCard stackCount={0}>
                    <button
                      type="button"
                      aria-label="Cancel import"
                      className="absolute left-2 top-2 z-10 text-white/40 hover:text-white/70 transition-colors"
                      onClick={() => {
                        setIsImporting(false);
                        setCsvError(null);
                      }}
                    >
                      <X className="size-4" />
                    </button>
                    <div className="flex w-full flex-col items-center gap-2 px-2">
                      <p className="text-xs text-white/60">
                        CSV must have{' '}
                        <code className="text-white/80">front</code> and{' '}
                        <code className="text-white/80">back</code> columns.
                      </p>
                      <Button
                        size="sm"
                        autoFocus
                        onClick={() => fileInputRef.current?.click()}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setIsImporting(false);
                            setCsvError(null);
                          }
                        }}
                        disabled={importCards.isPending}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        Choose File
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        data-testid="csv-file-input"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setCsvError(null);
                            handleCsvUpload(file);
                          }
                        }}
                      />
                      {csvError && (
                        <p className="text-xs text-destructive">{csvError}</p>
                      )}
                    </div>
                  </DeckCard>
                </motion.div>
              ) : (
                <motion.div
                  key="import-button"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                >
                  <DeckCard
                    stackCount={0}
                    className="cursor-pointer transition-shadow hover:shadow-lg"
                    onClick={() => setIsImporting(true)}
                  >
                    <Upload className="h-10 w-10 text-white/60" />
                    <p className="mt-2 text-sm font-medium text-white/60">
                      Import CSV
                    </p>
                  </DeckCard>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Existing cards */}
            {cards.map((card) => (
              <motion.div
                key={card.id}
                layout="position"
                transition={{ duration: 0.3, ease: 'easeInOut' }}
              >
                <div className="relative">
                  <FlashCardTile
                    front={card.front}
                    back={card.canonicalAnswer}
                    onSave={(front, back, keepVariantIds) =>
                      updateCard.mutate({
                        cardId: card.id,
                        front,
                        canonicalAnswers: answersWithPrimary(
                          card,
                          back,
                          keepVariantIds,
                        ),
                      })
                    }
                    onDelete={() => deleteCard.mutate({ cardId: card.id })}
                    onMarkKnown={() => markKnown.mutate({ cardIds: [card.id] })}
                    onShowHistory={() => setHistoryCardId(card.id)}
                    isSelecting={selection !== null}
                    isSaving={
                      updateCard.isPending &&
                      updateCard.variables?.cardId === card.id
                    }
                    variants={card.answers[0]?.acceptedVariants ?? []}
                  />
                  {selection && (
                    <SelectCardToggle
                      front={card.front}
                      selected={selection.has(card.id)}
                      onChange={(selected) => {
                        const next = new Set(selection);
                        if (selected) next.add(card.id);
                        else next.delete(card.id);
                        setSelection(next);
                      }}
                    />
                  )}
                </div>
                <CardAnswers
                  deckId={deckId}
                  card={card}
                  disabled={selection !== null}
                  isOpen={answersCardId === card.id}
                  onOpen={() => setAnswersCardId(card.id)}
                  onClose={() => setAnswersCardId(null)}
                />
              </motion.div>
            ))}
          </div>
        </LayoutGroup>
      </div>

      {historyCardId && (
        <CardVersionsDialog
          deckId={deckId}
          cardId={historyCardId}
          onClose={() => setHistoryCardId(null)}
        />
      )}

      {previewOpen && (
        <ImportPreviewDialog
          open={previewOpen}
          onClose={closePreview}
          onImport={(data) => importCards.mutate({ deckId: deckId!, ...data })}
          isPending={importCards.isPending}
          initialNewCards={previewNewCards}
          initialUpdateCards={previewUpdateCards}
          skippedRows={previewSkippedRows}
        />
      )}
    </CenteredPage>
  );
}
