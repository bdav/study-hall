---
status: accepted
---

# Accent mismatches are accepted with a correction, and never count as perfect recall

`updated-plan.md` §17.9 normalizes answers by stripping diacritics, so an answer that differs from a correct one only in accent marks is graded as an exact match. For Italian — the motivating use case — accents change meaning (_e_ "and" vs _è_ "is", _da_ "from" vs _dà_ "gives"), so silent acceptance teaches the wrong spelling. We amend §17.9: an accent mismatch is still accepted (it is not a miss), but the correct accented form is always shown. On exercises it counts as correct with a correction note; on cards it grades GOOD, never NAILED, so the card is scheduled as known but cannot reach the top grade with a missing or wrong accent.

## Considered Options

- Keep stripping diacritics silently (the v2 rule): rejected because it never corrects a meaning-changing error.
- Fully accent-sensitive grading (a mismatch is MISSED): rejected as the default because it punishes keyboard friction as heavily as not knowing the word. It may return later as a per-deck setting.
