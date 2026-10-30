-- AlterEnum
ALTER TYPE "AiPurpose" ADD VALUE 'COURSE_INTERVIEW';

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "interview" JSONB;
