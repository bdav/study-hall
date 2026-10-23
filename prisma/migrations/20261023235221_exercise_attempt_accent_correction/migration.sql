-- AlterTable
ALTER TABLE "ExerciseAttempt" ADD COLUMN     "accentCorrection" TEXT,
ALTER COLUMN "createdAt" SET DEFAULT now();
