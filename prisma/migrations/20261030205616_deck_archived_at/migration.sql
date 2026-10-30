-- DropIndex
DROP INDEX "Deck_userId_idx";

-- AlterTable
ALTER TABLE "Deck" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Deck_userId_archivedAt_idx" ON "Deck"("userId", "archivedAt");
