# Study Hall

Study Hall is a full-stack learning app. Today it is a flashcard study app where users can create decks, upload cards via CSV, study with instant feedback, and track their performance over time; AI-assisted courses with generated lessons, exercises and a tutor are planned (see `docs/architecture/courses-plan.md`). Built as an exercise in test-driven development with a modern TypeScript stack.

## Tech Stack

- **Frontend:** React 19, Vite, TypeScript, React Router, TanStack Query, Tailwind CSS, shadcn/ui
- **Backend:** Express 5, tRPC, Zod validation
- **Database:** PostgreSQL via Prisma ORM, run locally with Docker Compose
- **Monorepo:** pnpm workspaces

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) v8+
- [Docker](https://www.docker.com/) for the local Postgres database

## Getting Started

```bash
# Clone the repo
git clone <repo-url>
cd study-hall

# Install dependencies
pnpm install

# Start Postgres (must be running for development and API tests)
docker compose up -d

# Generate Prisma client
pnpm prisma generate

# Run database migrations
pnpm prisma migrate dev

# Seed the database with demo data
pnpm db:seed

# Start the app (API + web concurrently)
pnpm dev
```

The web app runs at **http://localhost:5173** and the API at **http://localhost:3001**.

Log in with the seed account: **dev@example.com** / **password** (dev only — do not use in production)

## Scripts

| Script                         | Description                           |
| ------------------------------ | ------------------------------------- |
| `pnpm dev`                     | Start both API and web dev servers    |
| `pnpm dev:api`                 | Start API server only (port 3001)     |
| `pnpm dev:web`                 | Start web dev server only (port 5173) |
| `pnpm --filter api test`       | Run API tests                         |
| `pnpm --filter web test`       | Run web tests                         |
| `pnpm --filter web test:watch` | Run web tests in watch mode           |
| `pnpm --filter web build`      | Production build of the web app       |
| `pnpm --filter web lint`       | Lint the web app                      |
| `pnpm lint`                    | Lint both apps                        |
| `pnpm format`                  | Format all files with Prettier        |
| `pnpm format:check`            | Check formatting                      |
| `pnpm prisma migrate dev`      | Run database migrations               |
| `pnpm prisma generate`         | Regenerate Prisma client              |
| `pnpm db:seed`                 | Seed database with demo data          |

## Environment Variables

| Variable            | Default             | Description                                                       |
| ------------------- | ------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`      | —                   | Postgres connection string (set in `.env`)                        |
| `CORS_ORIGIN`       | `localhost:*` (dev) | Allowed CORS origin for the API                                   |
| `ANTHROPIC_API_KEY` | —                   | Anthropic API key for course features (AI calls only)             |
| `AI_ALLOWED_EMAILS` | — (nobody)          | Comma-separated emails allowed to use AI features such as courses |

Create a `.env` file in the project root:

```
DATABASE_URL="postgresql://flashcards:flashcards@localhost:5432/flashcards"
```

## Repo Structure

```
study-hall/
  apps/
    web/          # Vite + React SPA
      src/
        components/   # Reusable UI components
        pages/        # Route-level page components
        hooks/        # Custom React hooks
        lib/          # Helpers, API client, query client
    api/          # Express + tRPC backend
      src/
        routers/      # tRPC route definitions (auth, deck, card, course, study, stats)
        services/     # Business logic (answer grading)
        ai/           # AI provider interface, access check and generation prompts
        auth/         # Password hashing, session helpers
  prisma/
    schema.prisma # Database schema
    seed.ts       # Seed script for demo data
    migrations/   # Prisma migrations
```

## CSV Import Format

Cards can be imported via CSV with exactly two columns:

```csv
front,back
Capital of France,Paris
2 + 2,4
What does HTTP stand for,HyperText Transfer Protocol
```

**Rules:**

- Header row with `front` and `back` is required
- Blank rows are ignored
- Whitespace is trimmed
- Rows missing either field are rejected

## Features

- **Auth:** Email/password signup and login with cookie-based sessions
- **Decks:** Create, rename, and delete flashcard decks
- **Cards:** Add cards one at a time or bulk import via CSV; edit and delete cards
- **Study:** Finite study sessions of due and new cards. Type your answer (or choose "I don't know"); answers are graded with normalized string matching that ignores case, punctuation and extra whitespace (but not the spaces between words). An answer wrong only in its accents is accepted as Good with the accented form shown. Each card is rescheduled after every answer
- **Stats:** Per-deck and overall stats including first-try accuracy, overall accuracy, attempts-to-correct per card, and weak card identification

## Testing

The project follows test-driven development. Tests use Vitest with React Testing Library on the frontend. API tests run against the Docker Compose Postgres, so it must be running (`docker compose up -d`); each test suite migrates and uses its own Postgres schema, which is dropped afterwards.

```bash
# Run all API tests
pnpm --filter api test

# Run all web tests
pnpm --filter web test
```

## Deployment Notes

- The app uses PostgreSQL in every environment. For production, set `DATABASE_URL` to the production database's connection string.
- The API serves tRPC over HTTP. A `/health` endpoint is available for health checks.
- CORS is configured to allow any localhost port in development. Set `CORS_ORIGIN` for production.
