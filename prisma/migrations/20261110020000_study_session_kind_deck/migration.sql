-- A deck's own Study Session is on its deck; a Today's Review has none of
-- its own, its decks being its StudySessionDeck rows (#136)
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_deck_by_kind"
  CHECK (("kind" = 'DECK') = ("deckId" IS NOT NULL));
