-- AlterEnum
ALTER TYPE "AiPurpose" ADD VALUE 'DIRECTION_LABELS';

-- AlterTable
ALTER TABLE "Deck" ADD COLUMN     "forwardLabelSuggested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reverseLabelSuggested" BOOLEAN NOT NULL DEFAULT false;
