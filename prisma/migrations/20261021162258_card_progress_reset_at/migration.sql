-- AlterTable
ALTER TABLE "CardProgress" ADD COLUMN     "resetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing progress started when it was created, so its attempts keep counting.
UPDATE "CardProgress" SET "resetAt" = "createdAt";
