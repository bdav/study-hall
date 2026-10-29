-- A Lesson Version can have several Tutor Threads, numbered from 1 (#62).
-- Each existing thread was its version's only one
-- AlterTable
ALTER TABLE "TutorThread" ADD COLUMN "number" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TutorThread" ALTER COLUMN "number" DROP DEFAULT;

-- DropIndex
DROP INDEX "TutorThread_lessonVersionId_key";

-- CreateIndex
CREATE UNIQUE INDEX "TutorThread_lessonVersionId_number_key" ON "TutorThread"("lessonVersionId", "number");
