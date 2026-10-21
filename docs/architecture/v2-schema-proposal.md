# v2 Prisma Schema Proposal

## Summary

This proposes the Phase 1 v2 schema. It covers the scheduler overhaul, session model,
canonical answers, and accepted variants. It defers marketplace, reverse decks, and
AI grading infrastructure models.

**Migration strategy:** Reset all data. Fresh Postgres migration. No backfill from MVP.

---

## Enums

```prisma
enum RecallGrade {
  MISSED
  PARTIALLY_CORRECT
  GOOD
  NAILED
}

enum CardLifecycleState {
  NEW
  LEARNING
  STABLE
  RETIRED
}

enum StudySessionStatus {
  ACTIVE
  COMPLETED
  ABANDONED
}

enum StudySessionItemStatus {
  PENDING
  COMPLETED
  SKIPPED
}

enum SessionType {
  QUICK
  STANDARD
  DEEP
}

enum StudyMode {
  STUDY
  DRILL_WEAKEST
  CRAM
}

enum GradingMethod {
  DETERMINISTIC
  SEMANTIC
  LLM
  REFINED_VARIANT
}
```

**Changes from MVP:**

- `AttemptResult` (correct/incorrect) → `RecallGrade` (4-level)
- New enums: `CardLifecycleState`, `StudySessionStatus`, `StudySessionItemStatus`,
  `SessionType`, `StudyMode`, `GradingMethod`

---

## Models

### User (unchanged)

```prisma
model User {
  id            String          @id @default(cuid())
  email         String          @unique
  passwordHash  String
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
  decks         Deck[]
  studySessions StudySession[]
  sessions      Session[]
  cardProgress  CardProgress[]
}
```

Only change: added `cardProgress` relation.

---

### Session (auth sessions — unchanged)

```prisma
model Session {
  id        String   @id @default(cuid())
  token     String   @unique
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

---

### Deck (unchanged)

```prisma
model Deck {
  id            String         @id @default(cuid())
  userId        String
  name          String
  description   String?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  cards         Card[]
  studySessions StudySession[]

  @@index([userId])
}
```

---

### Card (modified)

```prisma
model Card {
  id               String             @id @default(cuid())
  deckId           String
  front            String
  position         Int                @default(0)
  createdAt        DateTime           @default(now())
  updatedAt        DateTime           @updatedAt
  deck             Deck               @relation(fields: [deckId], references: [id], onDelete: Cascade)
  canonicalAnswers CanonicalAnswer[]
  attempts         CardAttempt[]
  progress         CardProgress[]
  sessionItems     StudySessionItem[]

  @@index([deckId])
  @@index([deckId, position])
}
```

**Changes:**

- **Removed `back`** — answers now live in `CanonicalAnswer` model
- **Added `position`** — sequential import order for new-card introduction (Int, default 0)
- **Added relations** to `CanonicalAnswer`, `CardProgress`, `StudySessionItem`
- **Added index** on `[deckId, position]` for new-card introduction order queries

---

### CanonicalAnswer (new)

```prisma
model CanonicalAnswer {
  id               String            @id @default(cuid())
  cardId           String
  text             String
  normalizedText   String?
  isPrimary        Boolean           @default(false)
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  card             Card              @relation(fields: [cardId], references: [id], onDelete: Cascade)
  acceptedVariants AcceptedVariant[]

  @@unique([cardId, text])
  @@index([cardId])
}
```

**Design notes:**

- A card has one or more canonical answers (e.g., `"11 || 13 || 17 || 19"` becomes 4 rows)
- `isPrimary` marks the displayed answer (shown after submission)
- `normalizedText` stores the pre-computed normalized form (lowercase, stripped punctuation/diacritics, trimmed) for deterministic grading. Computed on create/update in app code.
- `@@unique([cardId, text])` prevents duplicate canonical answers on the same card
- Editing canonical answers is potentially destructive — may reset progress (policy enforced in app code)
- Cascade delete with Card
- Grading checks user answer against all canonical answers + their accepted variants

---

### AcceptedVariant (new)

```prisma
model AcceptedVariant {
  id                String          @id @default(cuid())
  canonicalAnswerId String
  text              String
  normalizedText    String?
  createdAt         DateTime        @default(now())
  canonicalAnswer   CanonicalAnswer @relation(fields: [canonicalAnswerId], references: [id], onDelete: Cascade)

  @@unique([canonicalAnswerId, text])
  @@index([canonicalAnswerId])
}
```

**Design notes:**

- Paraphrases / surface forms of a canonical answer
- `normalizedText` stores pre-computed normalized form for deterministic grading (same normalization as CanonicalAnswer)
- `@@unique([canonicalAnswerId, text])` prevents duplicate variants per canonical answer
- Card-local, non-destructive to add
- Adding a variant does not affect progress/history
- Cascade delete with CanonicalAnswer

---

### CardProgress (new)

```prisma
model CardProgress {
  id               String             @id @default(cuid())
  userId           String
  cardId           String
  deckId           String
  lifecycleState   CardLifecycleState @default(NEW)
  masteryScore     Int                @default(0)
  dueAt            DateTime?
  lastReviewedAt   DateTime?
  lastIntervalDays Float?
  lapseCount       Int                @default(0)
  resetAt          DateTime           @default(now())
  createdAt        DateTime           @default(now())
  updatedAt        DateTime           @updatedAt
  user             User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  card             Card               @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@unique([userId, cardId])
  @@index([userId, deckId, lifecycleState, dueAt])
  @@index([userId, deckId, lifecycleState, masteryScore])
  @@index([userId, deckId, dueAt])
}
```

**Design notes:**

- One row per user per card, created eagerly at card creation/import. For the current single-user-per-deck model, this means every card in a user-owned deck has exactly one CardProgress row for the deck owner. Multi-user decks (marketplace/forking) would require revisiting this invariant.
- `deckId` is denormalized for query performance (avoids joining through Card for every queue query). **`deckId` must always equal `Card.deckId`; maintained in app code** — no FK to Deck.
- `dueAt` is nullable — NEW cards have no due date
- `lastIntervalDays` is Float to support sub-day intervals (e.g., 0.5 for 12 hours)
- Queue generation queries hit this table heavily — indexes designed for bucket queries
- `masteryScore` is 0–10 integer, clamped in app code
- `lifecycleState` transitions managed by explicit state machine in ProgressUpdater service
- `resetAt` is when the progress last started over from NEW: its creation, or an edit to the card's front or a Canonical Answer (ADR-0004). Only attempts made at or after `resetAt` count toward stats and scheduling; earlier attempts are kept as history. Added by #2.

---

### StudySession (modified)

```prisma
model StudySession {
  id          String             @id @default(cuid())
  userId      String
  deckId      String
  status      StudySessionStatus @default(ACTIVE)
  sessionType SessionType
  studyMode   StudyMode          @default(STUDY)
  startedAt   DateTime           @default(now())
  endedAt     DateTime?
  updatedAt   DateTime           @updatedAt
  user        User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  deck        Deck               @relation(fields: [deckId], references: [id], onDelete: Cascade)
  items       StudySessionItem[]
  attempts    CardAttempt[]

  @@index([userId])
  @@index([deckId])
  @@index([userId, deckId, status])
}
```

**Changes from MVP:**

- **Renamed `endedAt`** — now set on both COMPLETED and ABANDONED (status distinguishes the reason)
- **Added `status`** — `ACTIVE | COMPLETED | ABANDONED`
- **Added `sessionType`** — `QUICK | STANDARD | DEEP`
- **Added `studyMode`** — `STUDY | DRILL_WEAKEST | CRAM`. Note: `studyMode` affects queue generation weighting only, not progress/interval rules, unless explicitly coded otherwise.
- **Added `updatedAt`** — used for resume window calculation (24h based on last activity)
- **Added `items` relation** to `StudySessionItem`
- **Added index** on `[userId, deckId, status]` for finding active sessions

---

### StudySessionItem (new)

```prisma
model StudySessionItem {
  id             String                 @id @default(cuid())
  studySessionId String
  cardId         String
  position       Int
  status         StudySessionItemStatus @default(PENDING)
  createdAt      DateTime               @default(now())
  updatedAt      DateTime               @updatedAt
  studySession   StudySession           @relation(fields: [studySessionId], references: [id], onDelete: Cascade)
  card           Card                   @relation(fields: [cardId], references: [id], onDelete: Cascade)
  attempts       CardAttempt[]

  @@unique([studySessionId, position])
  @@index([studySessionId])
  @@index([studySessionId, status])
  @@index([cardId])
}
```

**Design notes:**

- Represents the persisted ordered queue for a session
- `position` determines presentation order
- `@@unique([studySessionId, position])` prevents duplicate positions within a session
- `PENDING` → not yet answered; `COMPLETED` → answered; `SKIPPED` → session ended before reaching (card was in the planned queue but not reached, NOT "user chose to skip")
- Same-session retry insertions create new `StudySessionItem` rows with later positions. Retry interaction state (e.g., how many retries remain, when to re-insert) is ephemeral/in-memory, but the scheduled retry appearances are persisted as additional StudySessionItem rows.
- Direct Card relation with cascade delete (consistent with CardAttempt cascade behavior)
- `attempts` back-relation to CardAttempt for the attempts made on this queue item

---

### CardAttempt (modified)

```prisma
model CardAttempt {
  id                    String            @id @default(cuid())
  studySessionId        String
  studySessionItemId    String?
  cardId                String
  userAnswer            String?
  recallGrade           RecallGrade
  attemptNumber         Int               @default(1)
  isRetry               Boolean           @default(false)
  gradingMethod         GradingMethod     @default(DETERMINISTIC)
  gradingConfidence     Float?
  semanticScore         Float?
  initialSuggestedGrade RecallGrade?
  refinementApplied     Boolean           @default(false)
  latencyMs             Int?
  createdAt             DateTime          @default(now())
  studySession          StudySession      @relation(fields: [studySessionId], references: [id], onDelete: Cascade)
  studySessionItem      StudySessionItem? @relation(fields: [studySessionItemId], references: [id], onDelete: SetNull)
  card                  Card              @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@index([studySessionId])
  @@index([studySessionItemId])
  @@index([cardId])
  @@index([studySessionId, cardId])
}
```

**Changes from MVP:**

- **`result` → `recallGrade`** — uses `RecallGrade` enum instead of `AttemptResult`
- **Added `isRetry`** — whether this attempt is a same-session retry
- **Added `studySessionItemId`** — optional link to the specific queue item with `onDelete: SetNull` (attempts survive if queue items are removed, though with session cascade they still go away when the whole session is deleted)
- **Added `attemptNumber`** — the nth attempt for this card within this study session (enforced in service logic)
- **Added grading metadata** — `gradingMethod`, `gradingConfidence`, `semanticScore`,
  `initialSuggestedGrade`, `refinementApplied`, `latencyMs`
- **Deferred fields** (add when AI grading phase begins): `modelUsed`, `promptVersion`,
  `gradingPipelineVersion`

---

## Relationship Diagram

```
User
 ├── Deck
 │    ├── Card
 │    │    ├── CanonicalAnswer
 │    │    │    └── AcceptedVariant
 │    │    ├── CardProgress (per user)
 │    │    └── CardAttempt
 │    └── StudySession
 │         ├── StudySessionItem
 │         └── CardAttempt
 └── CardProgress
```

---

## Key Invariants

1. Every card in a user-owned deck has exactly one CardProgress row for the deck owner (created eagerly). Multi-user decks (marketplace/forking) would require revisiting this.
2. Every Card has at least one CanonicalAnswer (enforced in app code, not DB constraint)
3. CardProgress is the authority for queue generation
4. CardAttempt is the append-only historical truth
5. CardAttempt + CardProgress update atomically in one transaction
6. StudySessionItem represents the persisted queue. Retry interaction state (how many retries remain, when to re-insert) is ephemeral/in-memory, but scheduled retry appearances are persisted as additional StudySessionItem rows.
7. Cascade deletes propagate through all parent relationships
8. `CardProgress.deckId` must always equal `Card.deckId` — maintained in app code (denormalized for query performance)
9. `attemptNumber` on CardAttempt is the nth attempt for a given card within a given study session — enforced in service logic

---

## Migration Notes

- This is a **fresh migration** — no data preservation from MVP
- Switch datasource from `sqlite` to `postgresql`
- Seed script will create: demo user, sample decks, sample cards with canonical answers,
  eagerly-created CardProgress rows
- All existing MVP migrations should be deleted; start fresh migration history

---

## What This Schema Does NOT Include (Deferred)

| Model             | Phase                |
| ----------------- | -------------------- |
| ReverseDeckLink   | Reverse deck feature |
| MarketplaceDeck   | Marketplace          |
| DeckFork          | Marketplace          |
| ChangelogEvent    | Marketplace          |
| ContributionInbox | Marketplace          |
| AIGradingCache    | AI grading           |
| AIUsageLog        | AI grading           |

These can be added as separate migrations when their respective phases begin.
