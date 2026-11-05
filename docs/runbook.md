# Runbook

How Study Hall runs in production, for whoever operates it months from now. The decisions behind it are in #91, and setting up the hosts is #109.

## Architecture

| Part     | Host    | Address                       |
| -------- | ------- | ----------------------------- |
| Web app  | Vercel  | `study.beaudavenport.com`     |
| API      | Railway | `api.study.beaudavenport.com` |
| Postgres | Railway | Only the API uses it          |

The two addresses are subdomains of one domain, so they count as the same site. The API's login cookie (HttpOnly, `SameSite=Lax`, host-only, `Secure` in production) reaches it from the web app with no cookie domain and no `SameSite=None`, Safari on iOS included.

The API is one long-running Node process, started with `tsx` as in dev, with no compile step. Generations take minutes and the tutor streams its replies, which rules out serverless.

## Environment variables

Secrets live only in the hosts' settings, with 1Password as the maintainer's own record. Nothing secret goes in the repository, or in the web app's build, which is public.

**API, on Railway**

| Variable                | What it does                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`          | The Postgres connection string. Also needed to run `prisma generate`, which doesn't connect                        |
| `NODE_ENV`              | `production`. Marks the login cookie `Secure`, makes the seed refuse to run, and skips dev dependencies on install |
| `PORT`                  | The port to listen on, set by Railway. 3001 when unset                                                             |
| `CORS_ORIGIN`           | The web app's address, `https://study.beaudavenport.com`. Unset, only localhost is allowed                         |
| `ANTHROPIC_API_KEY`     | Production's own key, in its own Anthropic workspace. Read by the Anthropic SDK; only AI calls need it             |
| `SIGNUP_ALLOWED_EMAILS` | Comma-separated emails that may make an account. Unset, nobody can. Never grants AI                                |
| `AI_ALLOWED_EMAILS`     | Comma-separated emails that may use AI. Unset, nobody can. Never grants signup                                     |
| `AI_MONTHLY_CAP_USD`    | The month's AI spending cap in US dollars, across all users. Unset or invalid, AI is paused                        |

**Web app, on Vercel**

| Variable       | What it does                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | The API's tRPC address, `https://api.study.beaudavenport.com/trpc`, `/trpc` included. Read at build time, so changing it needs a rebuild |

## How a deploy runs

A push to `main` goes through these, in order. If one fails, the ones after it don't run, and the running version stays up.

1. **CI** runs typecheck, lint and both test suites (`.github/workflows/ci.yml`). The hosts deploy only once it passes.
2. **Install:** `pnpm install --frozen-lockfile`. With `NODE_ENV=production` this skips dev dependencies, so anything needed at run time, `tsx` and `prisma` included, has to be a dependency. `prepare` is `husky || true` because Husky is a dev dependency.
3. **Build:** `pnpm prisma generate`. There's nothing else to build.
4. **Migrate:** `pnpm db:deploy`, Railway's pre-deploy step, runs `prisma migrate deploy`. A failed migration stops the deploy.
5. **Start:** `pnpm start`. `/health` answers `{"ok":true}` once it's up.

The web app's build on Vercel is:

```sh
DATABASE_URL=postgresql://unused pnpm prisma generate && pnpm --filter web build
```

Its output is `apps/web/dist`. The web app imports the API's types, so its typecheck needs the Prisma client generated. Generating never connects, so the URL is a placeholder, and Vercel holds no database address. The app routes in the browser, so every path has to serve `index.html`, with a rewrite in Vercel's config.

Applied migrations are never edited or deleted, and `migrate dev` never runs in production. The seed refuses to run there: it would create an account with a known password.

## Inviting someone

Add their email to `SIGNUP_ALLOWED_EMAILS` on Railway, comma-separated, with no code change. The API reads it from its environment, so the invitation counts once the API has restarted with the new value. Then they sign up at `study.beaudavenport.com` with that email; anyone else is told signup is by invitation. The allowlist ignores case, but accounts don't: they log in with the email exactly as they signed up with it, so ask them to type it as you listed it.

An invitation doesn't include AI. To give someone AI too, add them to `AI_ALLOWED_EMAILS` as well. Removing an email from the signup allowlist stops it signing up, and doesn't touch an account it already made.

In dev, signing up needs the same variable in `.env`, listing the email you sign up with, and an API restarted since you added it. The seed's account, `dev@example.com`, needs nothing: it's created directly and logs in as usual.

## Resetting a forgotten password

There's no password reset in the app and no email sending, so it's done by hand.

1. On your laptop, in the repository, hash the new password with the app's own `hashPassword`. It refuses anything under 8 characters, the rule signup sets, and `read` keeps the password out of your shell history. This `read` is zsh's, macOS's default shell.

   ```sh
   read -rs 'NEW_PASSWORD?New password: '; echo
   NEW_PASSWORD="$NEW_PASSWORD" pnpm --filter api exec tsx -e "
     import('./src/auth/password.ts').then(async ({ hashPassword }) => {
       const password = process.env.NEW_PASSWORD ?? '';
       if (password.length < 8) throw new Error('At least 8 characters');
       console.log(await hashPassword(password));
     });"
   unset NEW_PASSWORD
   ```

2. Connect to the production database with `railway connect postgres`, which needs the Railway CLI, linked to the project, and `psql` on your laptop.

3. Set the hash, single quotes around it, and clear that user's login sessions, which logs them out on every device. Use the email exactly as they signed up with it.

   ```sql
   UPDATE "User" SET "passwordHash" = '<the hash>', "updatedAt" = now() WHERE email = '<their email>';
   DELETE FROM "Session" WHERE "userId" = (SELECT id FROM "User" WHERE email = '<their email>');
   ```

   `UPDATE 1` means it found the account. `UPDATE 0` means the email didn't match, and nothing changed.

4. Log in with the new password.
