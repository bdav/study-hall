-- Each regeneration round's feedback becomes { chips, text }: earlier
-- feedback was text alone, so each piece becomes a round with no chips,
-- oldest first. A new column, since a column's type change can't run a
-- subquery over its old values.
ALTER TABLE "SyllabusProposal" ADD COLUMN "feedbackRounds" JSONB NOT NULL DEFAULT '[]';

UPDATE "SyllabusProposal" SET "feedbackRounds" = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('chips', '[]'::jsonb, 'text', round.text)
      ORDER BY round.position
    ),
    '[]'::jsonb
  )
  FROM unnest("feedback") WITH ORDINALITY AS round(text, position)
);

ALTER TABLE "SyllabusProposal" DROP COLUMN "feedback";

ALTER TABLE "SyllabusProposal" RENAME COLUMN "feedbackRounds" TO "feedback";
