-- A learner has at most one unfinished Study Session on a deck. Of any
-- already active together, the most recently active stays; the others are
-- abandoned at their last activity, their queues left as they were.
UPDATE "StudySession" s
SET "status" = 'ABANDONED', "endedAt" = s."updatedAt"
WHERE s."status" = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM "StudySession" t
    WHERE t."userId" = s."userId"
      AND t."deckId" = s."deckId"
      AND t."status" = 'ACTIVE'
      AND (t."updatedAt", t."id") > (s."updatedAt", s."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "StudySession_one_active_per_deck" ON "StudySession"("userId", "deckId") WHERE (status = 'ACTIVE');
