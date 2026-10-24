-- AlterEnum
ALTER TYPE "AiPurpose" ADD VALUE 'CARD_PROPOSAL';

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "sourceLessonId" TEXT,
ADD COLUMN     "sourceModel" TEXT,
ADD COLUMN     "sourcePromptVersion" TEXT;

-- CreateIndex
CREATE INDEX "Card_sourceLessonId_idx" ON "Card"("sourceLessonId");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_sourceLessonId_fkey" FOREIGN KEY ("sourceLessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
