-- Exercises generated before the split have no essential or supplementary
-- points; a free-form one keeps its flat expectedPoints (ADR-0006)
UPDATE "Exercise" SET "essentialPoints" = '{}' WHERE "essentialPoints" IS NULL;
UPDATE "Exercise" SET "supplementaryPoints" = '{}' WHERE "supplementaryPoints" IS NULL;
