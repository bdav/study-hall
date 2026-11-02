
-- CreateEnum
CREATE TYPE "StudyDirection" AS ENUM ('FORWARD', 'REVERSE');

-- DropIndex
DROP INDEX "CardAttempt_cardId_idx";

-- DropIndex
DROP INDEX "CardProgress_userId_cardId_key";

-- DropIndex
DROP INDEX "CardProgress_userId_deckId_dueAt_idx";

-- DropIndex
DROP INDEX "CardProgress_userId_deckId_lifecycleState_dueAt_idx";

-- DropIndex
DROP INDEX "CardProgress_userId_deckId_lifecycleState_masteryScore_idx";

-- AlterTable
ALTER TABLE "CardAttempt" ADD COLUMN     "direction" "StudyDirection" NOT NULL DEFAULT 'FORWARD';

-- AlterTable
ALTER TABLE "CardProgress" ADD COLUMN     "direction" "StudyDirection" NOT NULL DEFAULT 'FORWARD';

-- AlterTable
ALTER TABLE "CardVersion" ADD COLUMN     "reverseVariants" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Deck" ADD COLUMN     "forwardLabel" TEXT,
ADD COLUMN     "reverseLabel" TEXT,
ADD COLUMN     "reversible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StudySession" ADD COLUMN     "direction" "StudyDirection" NOT NULL DEFAULT 'FORWARD';

-- CreateTable
CREATE TABLE "ReverseVariant" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReverseVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReverseVariant_cardId_idx" ON "ReverseVariant"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "ReverseVariant_cardId_text_key" ON "ReverseVariant"("cardId", "text");

-- CreateIndex
CREATE INDEX "CardAttempt_cardId_direction_idx" ON "CardAttempt"("cardId", "direction");

-- CreateIndex
CREATE INDEX "CardProgress_userId_deckId_direction_lifecycleState_dueAt_idx" ON "CardProgress"("userId", "deckId", "direction", "lifecycleState", "dueAt");

-- CreateIndex
CREATE INDEX "CardProgress_userId_deckId_direction_lifecycleState_mastery_idx" ON "CardProgress"("userId", "deckId", "direction", "lifecycleState", "masteryScore");

-- CreateIndex
CREATE INDEX "CardProgress_userId_deckId_direction_dueAt_idx" ON "CardProgress"("userId", "deckId", "direction", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CardProgress_userId_cardId_direction_key" ON "CardProgress"("userId", "cardId", "direction");

-- AddForeignKey
ALTER TABLE "ReverseVariant" ADD CONSTRAINT "ReverseVariant_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every card has progress in each Study Direction (ADR-0011): its Reverse
-- progress starts NEW, and existing progress is Forward
INSERT INTO "CardProgress" ("id", "userId", "cardId", "deckId", "direction", "resetAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."userId", p."cardId", p."deckId", 'REVERSE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CardProgress" p
WHERE p."direction" = 'FORWARD';
