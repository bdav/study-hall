-- AlterTable
ALTER TABLE "CardAttempt" ADD COLUMN     "cardVersionId" TEXT;

-- CreateTable
CREATE TABLE "CardVersion" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "front" TEXT NOT NULL,
    "canonicalAnswers" TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardVersion_cardId_number_key" ON "CardVersion"("cardId", "number");

-- CreateIndex
CREATE INDEX "CardAttempt_cardVersionId_idx" ON "CardAttempt"("cardVersionId");

-- AddForeignKey
ALTER TABLE "CardVersion" ADD CONSTRAINT "CardVersion_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAttempt" ADD CONSTRAINT "CardAttempt_cardVersionId_fkey" FOREIGN KEY ("cardVersionId") REFERENCES "CardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (ADR-0008): each card gets one version from what it asks now,
-- starting at its latest progress reset, and the attempts made since then
-- answered it. Older attempts answered an earlier form, so have none.
INSERT INTO "CardVersion" ("id", "cardId", "number", "front", "canonicalAnswers", "startedAt")
SELECT
    gen_random_uuid()::text,
    c."id",
    1,
    c."front",
    ARRAY(
        SELECT a."text" FROM "CanonicalAnswer" a
        WHERE a."cardId" = c."id"
        ORDER BY a."isPrimary" DESC, a."position" ASC, a."createdAt" ASC
    ),
    COALESCE(
        (SELECT MAX(p."resetAt") FROM "CardProgress" p WHERE p."cardId" = c."id"),
        c."createdAt"
    )
FROM "Card" c;

UPDATE "CardAttempt" t
SET "cardVersionId" = v."id"
FROM "CardVersion" v
WHERE v."cardId" = t."cardId" AND t."createdAt" >= v."startedAt";
