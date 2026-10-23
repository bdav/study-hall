-- CreateEnum
CREATE TYPE "ExerciseEvaluation" AS ENUM ('CORRECT', 'INCORRECT');

-- CreateEnum
CREATE TYPE "EvaluationMethod" AS ENUM ('DETERMINISTIC');

-- CreateTable
CREATE TABLE "ExerciseAttempt" (
    "id" TEXT NOT NULL,
    "lessonVersionId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "evaluation" "ExerciseEvaluation" NOT NULL,
    "method" "EvaluationMethod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExerciseAttempt_exerciseId_createdAt_idx" ON "ExerciseAttempt"("exerciseId", "createdAt");

-- CreateIndex
CREATE INDEX "ExerciseAttempt_lessonVersionId_idx" ON "ExerciseAttempt"("lessonVersionId");

-- AddForeignKey
ALTER TABLE "ExerciseAttempt" ADD CONSTRAINT "ExerciseAttempt_lessonVersionId_fkey" FOREIGN KEY ("lessonVersionId") REFERENCES "LessonVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseAttempt" ADD CONSTRAINT "ExerciseAttempt_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
