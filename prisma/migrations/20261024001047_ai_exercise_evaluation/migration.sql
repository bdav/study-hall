-- AlterEnum
ALTER TYPE "AiPurpose" ADD VALUE 'EXERCISE_EVALUATION';

-- AlterEnum
ALTER TYPE "EvaluationMethod" ADD VALUE 'LLM';

-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "open" BOOLEAN NOT NULL DEFAULT false;

-- Free-form explanations have always been open (ADR-0005)
UPDATE "Exercise" SET "open" = true WHERE "type" = 'FREE_FORM_EXPLANATION';

-- AlterTable
ALTER TABLE "ExerciseAttempt" ADD COLUMN     "feedback" TEXT;
