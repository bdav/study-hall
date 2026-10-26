---
status: accepted
---

# Card edits reset progress but keep attempts

Editing a card's front or a Canonical Answer changes what the card asks for, so the learner's progress on the old card no longer applies. Editing an Accepted Variant doesn't change what is asked. The MVP handled edits by deleting the card's attempts, which conflicts with ADR-0003's principle that learning history is durable. So editing the front or a Canonical Answer resets the card's progress to NEW and keeps its attempts. Only attempts made since the card's latest progress reset count toward stats and scheduling: mastery, lifecycle transitions and weak-card detection. Adding or removing an Accepted Variant never resets progress. This settles the open reset policy in `updated-plan.md` §18.1.

## Considered Options

- **Delete attempts on edit (the MVP behaviour):** rejected because it destroys learning history.
- **Keep all attempts and let them keep counting:** rejected because answers to the old card would distort mastery, lapses and weak-card detection for what is effectively a new card.
- **Card versioning, with attempts tied to the card version they answered:** rejected for v2 because it adds a model and touches every attempt query, for a history view nobody has asked for yet.

## Consequences

- Any rule that judges how well a card is known must ignore attempts made before the card's latest progress reset. Queries that show history should include them.
- Known limitation: an attempt doesn't record the card content it answered, so after an edit, earlier attempts can't be shown with the prompt and answers they were judged against. Card versioning would fix this if that view is ever needed. ADR-0008 adds it.
