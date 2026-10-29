-- AlterTable
ALTER TABLE "SyllabusProposal" ADD COLUMN     "feedback" TEXT[] DEFAULT ARRAY[]::TEXT[];
