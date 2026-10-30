-- AlterTable
ALTER TABLE "LessonVersion" ADD COLUMN     "feedbackChips" TEXT[] DEFAULT ARRAY[]::TEXT[];
