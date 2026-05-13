-- CreateEnum
CREATE TYPE "RecallGrade" AS ENUM ('MISSED', 'PARTIALLY_CORRECT', 'GOOD', 'NAILED');

-- CreateEnum
CREATE TYPE "CardLifecycleState" AS ENUM ('NEW', 'LEARNING', 'STABLE', 'RETIRED');

-- CreateEnum
CREATE TYPE "StudySessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "StudySessionItemStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('QUICK', 'STANDARD', 'DEEP');

-- CreateEnum
CREATE TYPE "StudyMode" AS ENUM ('STUDY', 'DRILL_WEAKEST', 'CRAM');

-- CreateEnum
CREATE TYPE "GradingMethod" AS ENUM ('DETERMINISTIC', 'SEMANTIC', 'LLM', 'REFINED_VARIANT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "front" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalAnswer" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcceptedVariant" (
    "id" TEXT NOT NULL,
    "canonicalAnswerId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcceptedVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "lifecycleState" "CardLifecycleState" NOT NULL DEFAULT 'NEW',
    "masteryScore" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "lastIntervalDays" DOUBLE PRECISION,
    "lapseCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "status" "StudySessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "sessionType" "SessionType" NOT NULL,
    "studyMode" "StudyMode" NOT NULL DEFAULT 'STUDY',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySessionItem" (
    "id" TEXT NOT NULL,
    "studySessionId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "StudySessionItemStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudySessionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAttempt" (
    "id" TEXT NOT NULL,
    "studySessionId" TEXT NOT NULL,
    "studySessionItemId" TEXT,
    "cardId" TEXT NOT NULL,
    "userAnswer" TEXT,
    "recallGrade" "RecallGrade" NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "isRetry" BOOLEAN NOT NULL DEFAULT false,
    "gradingMethod" "GradingMethod" NOT NULL DEFAULT 'DETERMINISTIC',
    "gradingConfidence" DOUBLE PRECISION,
    "semanticScore" DOUBLE PRECISION,
    "initialSuggestedGrade" "RecallGrade",
    "refinementApplied" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Deck_userId_idx" ON "Deck"("userId");

-- CreateIndex
CREATE INDEX "Card_deckId_idx" ON "Card"("deckId");

-- CreateIndex
CREATE INDEX "Card_deckId_position_idx" ON "Card"("deckId", "position");

-- CreateIndex
CREATE INDEX "CanonicalAnswer_cardId_idx" ON "CanonicalAnswer"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalAnswer_cardId_text_key" ON "CanonicalAnswer"("cardId", "text");

-- CreateIndex
CREATE INDEX "AcceptedVariant_canonicalAnswerId_idx" ON "AcceptedVariant"("canonicalAnswerId");

-- CreateIndex
CREATE UNIQUE INDEX "AcceptedVariant_canonicalAnswerId_text_key" ON "AcceptedVariant"("canonicalAnswerId", "text");

-- CreateIndex
CREATE INDEX "CardProgress_userId_deckId_lifecycleState_dueAt_idx" ON "CardProgress"("userId", "deckId", "lifecycleState", "dueAt");

-- CreateIndex
CREATE INDEX "CardProgress_userId_deckId_lifecycleState_masteryScore_idx" ON "CardProgress"("userId", "deckId", "lifecycleState", "masteryScore");

-- CreateIndex
CREATE INDEX "CardProgress_userId_deckId_dueAt_idx" ON "CardProgress"("userId", "deckId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CardProgress_userId_cardId_key" ON "CardProgress"("userId", "cardId");

-- CreateIndex
CREATE INDEX "StudySession_userId_idx" ON "StudySession"("userId");

-- CreateIndex
CREATE INDEX "StudySession_deckId_idx" ON "StudySession"("deckId");

-- CreateIndex
CREATE INDEX "StudySession_userId_deckId_status_idx" ON "StudySession"("userId", "deckId", "status");

-- CreateIndex
CREATE INDEX "StudySessionItem_studySessionId_idx" ON "StudySessionItem"("studySessionId");

-- CreateIndex
CREATE INDEX "StudySessionItem_studySessionId_status_idx" ON "StudySessionItem"("studySessionId", "status");

-- CreateIndex
CREATE INDEX "StudySessionItem_cardId_idx" ON "StudySessionItem"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "StudySessionItem_studySessionId_position_key" ON "StudySessionItem"("studySessionId", "position");

-- CreateIndex
CREATE INDEX "CardAttempt_studySessionId_idx" ON "CardAttempt"("studySessionId");

-- CreateIndex
CREATE INDEX "CardAttempt_studySessionItemId_idx" ON "CardAttempt"("studySessionItemId");

-- CreateIndex
CREATE INDEX "CardAttempt_cardId_idx" ON "CardAttempt"("cardId");

-- CreateIndex
CREATE INDEX "CardAttempt_studySessionId_cardId_idx" ON "CardAttempt"("studySessionId", "cardId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalAnswer" ADD CONSTRAINT "CanonicalAnswer_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptedVariant" ADD CONSTRAINT "AcceptedVariant_canonicalAnswerId_fkey" FOREIGN KEY ("canonicalAnswerId") REFERENCES "CanonicalAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardProgress" ADD CONSTRAINT "CardProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardProgress" ADD CONSTRAINT "CardProgress_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySessionItem" ADD CONSTRAINT "StudySessionItem_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySessionItem" ADD CONSTRAINT "StudySessionItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAttempt" ADD CONSTRAINT "CardAttempt_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAttempt" ADD CONSTRAINT "CardAttempt_studySessionItemId_fkey" FOREIGN KEY ("studySessionItemId") REFERENCES "StudySessionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAttempt" ADD CONSTRAINT "CardAttempt_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
