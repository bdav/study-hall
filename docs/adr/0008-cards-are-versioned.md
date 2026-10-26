---
status: accepted
---

# Cards are versioned, and each attempt records the version it answered

A card's history is only meaningful if it shows which question each answer was given to. ADR-0004 kept attempts across edits but couldn't tell which form of the card an attempt answered, and rejected card versioning as unneeded. Learners now want to see their answers to a card, and to an earlier form of it. So a card has Card Versions: its first when it is created, and a new one whenever its front or a Canonical Answer changes, which is exactly when ADR-0004 resets its progress. Every Card Attempt records the version it answered. Accepted Variants don't change what a card asks, only how answers to it are graded, so changing them never makes a version.

## Considered Options

- **Snapshot the front and answer on each attempt, with no version model:** cheaper, but it can't tell apart two periods when the card asked the same thing, and versions would be inferred rather than recorded.
- **A new version for Accepted Variant changes too:** rejected, because a version would then no longer mean a progress reset, and the learner's current history would split every time they accepted an answer during study.

## Consequences

- Version boundaries and progress resets coincide: the current version's attempts are the ones scheduling and stats count (ADR-0004).
- Attempts made before versions were recorded, and before the card's last reset, can't be tied to a version. History shows them as from an earlier version.
- A version records the Accepted Variants its answers ended with, when the edit that ends it starts the next (#51), so history can show an earlier version as it was. Changing variants still never starts a version; the current version's variants are the card's own. Versions that ended before this was recorded have none.
