-- A Study Session records the decks it was built from and each item its
-- Study Direction (#136), so Today's Review can span decks (ADR-0013).

-- CreateEnum
CREATE TYPE "StudySessionKind" AS ENUM ('DECK', 'TODAYS_REVIEW');

-- AlterTable
ALTER TABLE "StudySession" ADD COLUMN "kind" "StudySessionKind" NOT NULL DEFAULT 'DECK',
ALTER COLUMN "deckId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StudySessionDeck" (
    "studySessionId" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,

    CONSTRAINT "StudySessionDeck_pkey" PRIMARY KEY ("studySessionId","deckId")
);

-- CreateIndex
CREATE INDEX "StudySessionDeck_deckId_idx" ON "StudySessionDeck"("deckId");

-- AddForeignKey
ALTER TABLE "StudySessionDeck" ADD CONSTRAINT "StudySessionDeck_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySessionDeck" ADD CONSTRAINT "StudySessionDeck_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every session so far is a deck's own, built from its deck
INSERT INTO "StudySessionDeck" ("studySessionId", "deckId")
SELECT "id", "deckId" FROM "StudySession";

-- Each item asks its card the way its session did
ALTER TABLE "StudySessionItem" ADD COLUMN "direction" "StudyDirection";
UPDATE "StudySessionItem" i
SET "direction" = s."direction"
FROM "StudySession" s
WHERE i."studySessionId" = s."id";
ALTER TABLE "StudySessionItem" ALTER COLUMN "direction" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "StudySession_one_active_todays_review" ON "StudySession"("userId", "kind") WHERE (status = 'ACTIVE' AND kind = 'TODAYS_REVIEW');
