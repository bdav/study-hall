-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('SHORT_ANSWER', 'FILL_IN_THE_BLANK', 'FREE_FORM_EXPLANATION');

-- AlterEnum
ALTER TYPE "AiPurpose" ADD VALUE 'LESSON_GENERATION';

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "firstOpenedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LessonVersion" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "examples" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "lessonVersionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "ExerciseType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "expectedAnswers" TEXT[],
    "expectedPoints" TEXT[],

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonVersion_lessonId_createdAt_idx" ON "LessonVersion"("lessonId", "createdAt");

-- CreateIndex
CREATE INDEX "Exercise_lessonVersionId_position_idx" ON "Exercise"("lessonVersionId", "position");

-- AddForeignKey
ALTER TABLE "LessonVersion" ADD CONSTRAINT "LessonVersion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_lessonVersionId_fkey" FOREIGN KEY ("lessonVersionId") REFERENCES "LessonVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
