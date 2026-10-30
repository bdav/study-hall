-- Time per week and session length become amounts of time, in minutes
ALTER TABLE "Course" ADD COLUMN "minutesPerWeek" INTEGER,
ADD COLUMN "sessionMinutes" INTEGER;

-- Fill minutes per week from the old free text where it reads as hours
-- and/or minutes ("3 hours", "3 hrs", "1.5h", "90 minutes", "2 hours 30
-- min", "3 hours a week"), leaving it null where it doesn't, such as a bare
-- number with no unit
WITH parsed AS (
  SELECT
    "id",
    regexp_match(
      lower(trim("timePerWeek")),
      '^(?:(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?))?\s*(?:and\s*)?(?:(\d+)\s*(?:m|mins?|minutes?))?(?:\s*(?:a|per|/)\s*(?:week|wk))?$'
    ) AS m
  FROM "Course"
)
UPDATE "Course" AS c
SET "minutesPerWeek" = NULLIF(
  round(coalesce(p.m[1]::numeric, 0) * 60 + coalesce(p.m[2]::numeric, 0))::integer,
  0
)
FROM parsed AS p
WHERE c."id" = p."id"
  AND p.m IS NOT NULL
  AND (p.m[1] IS NOT NULL OR p.m[2] IS NOT NULL);

ALTER TABLE "Course" DROP COLUMN "timePerWeek";
