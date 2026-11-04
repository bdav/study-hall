-- AlterTable
ALTER TABLE "Deck" ADD COLUMN "cramUntil" DATE;

-- A Course Deck's Cram date starts at its course's deadline (#87)
UPDATE "Deck" AS deck
SET "cramUntil" = course."deadline"
FROM "Course" AS course
WHERE deck."courseId" = course."id"
  AND course."deadline" >= CURRENT_DATE;
