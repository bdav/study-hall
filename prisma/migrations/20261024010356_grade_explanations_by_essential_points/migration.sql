-- AlterEnum
ALTER TYPE "ExerciseEvaluation" ADD VALUE 'PARTIALLY_CORRECT';

-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "essentialPoints" TEXT[],
ADD COLUMN     "supplementaryPoints" TEXT[];

-- AlterTable
ALTER TABLE "ExerciseAttempt" ADD COLUMN     "assessment" JSONB;
