-- CreateEnum
CREATE TYPE "TutorRole" AS ENUM ('LEARNER', 'TUTOR');

-- AlterEnum
ALTER TYPE "AiPurpose" ADD VALUE 'TUTOR';

-- CreateTable
CREATE TABLE "TutorThread" (
    "id" TEXT NOT NULL,
    "lessonVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TutorThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" "TutorRole" NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TutorMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TutorThread_lessonVersionId_key" ON "TutorThread"("lessonVersionId");

-- CreateIndex
CREATE INDEX "TutorMessage_threadId_createdAt_idx" ON "TutorMessage"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "TutorThread" ADD CONSTRAINT "TutorThread_lessonVersionId_fkey" FOREIGN KEY ("lessonVersionId") REFERENCES "LessonVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorMessage" ADD CONSTRAINT "TutorMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "TutorThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
