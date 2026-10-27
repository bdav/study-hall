-- AlterEnum
ALTER TYPE "AiPurpose" ADD VALUE 'CARD_REVISION';

-- AlterTable
ALTER TABLE "CardVersion" ADD COLUMN     "sourceModel" TEXT,
ADD COLUMN     "sourcePromptVersion" TEXT;
