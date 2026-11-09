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

| Variable                | What it does                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`          | The Postgres connection string. Also needed to run `prisma generate`, which doesn't connect                                    |
| `NODE_ENV`              | `production`. Marks the login cookie `Secure`, makes the seed refuse to run, and skips dev dependencies on install             |
| `PORT`                  | The port to listen on, set by Railway. 3001 when unset                                                                         |
| `CORS_ORIGIN`           | The web app's address, `https://study.beaudavenport.com`. Unset in production, no site can call the API; in dev, localhost can |
| `ANTHROPIC_API_KEY`     | Production's own key, in its own Anthropic workspace. Read by the Anthropic SDK; only AI calls need it                         |
| `SIGNUP_ALLOWED_EMAILS` | Comma-separated emails that may make an account. Unset, nobody can. Never grants AI                                            |
| `AI_ALLOWED_EMAILS`     | Comma-separated emails that may use AI. Unset, nobody can. Never grants signup                                                 |
| `AI_MONTHLY_CAP_USD`    | The month's AI spending cap in US dollars, across all users. Unset or invalid, AI is paused                                    |
| `SENTRY_DSN`            | Where the API reports server errors. Unset, it reports nothing                                                                 |
| `RAILPACK_NODE_VERSION` | `22`, as CI runs. Railway's builder reads it first, ahead of `engines.node` in `package.json`, which Vercel reads              |

**Web app, on Vercel**

| Variable          | What it does                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`    | The API's tRPC address, `https://api.study.beaudavenport.com/trpc`, `/trpc` included. Read at build time, so changing it needs a rebuild |
| `VITE_SENTRY_DSN` | Where the web app reports crashes. Unset, it reports nothing. Read at build time, and public by design: a DSN can only send reports      |

## How a deploy runs

A push to `main` goes through these, in order. If one fails, the ones after it don't run, and the running version stays up.

1. **CI** runs typecheck, lint and both test suites (`.github/workflows/ci.yml`). The hosts deploy only once it passes. CI is four jobs, so Vercel, which waits on named checks, names all four. Railway can't name them (below).
2. **Install:** `pnpm install --frozen-lockfile`. With `NODE_ENV=production` this skips dev dependencies, so anything needed at run time, `tsx` and `prisma` included, has to be a dependency. `prepare` is `husky || true` because Husky is a dev dependency.
3. **Build:** `pnpm prisma generate`. There's nothing else to build.
4. **Migrate:** `pnpm db:deploy`, Railway's pre-deploy step, runs `prisma migrate deploy`. A failed migration stops the deploy.
5. **Start:** `pnpm start`. `/health` answers `{"ok":true}` once it's up.

The web app's build on Vercel is:

```sh
DATABASE_URL=postgresql://unused pnpm prisma generate && pnpm --filter web build
```

Its output is `apps/web/dist`. The web app imports the API's types, so its typecheck needs the Prisma client generated. Generating never connects, so the URL is a placeholder, and Vercel holds no database address. The app routes in the browser, so every path has to serve `index.html`, with a rewrite. All of this is in `vercel.json`, which also skips every deployment but production's, as there are no previews.

Railway's commands, and Wait for CI, are its service's settings, in its dashboard. `railway.json` stops being read on 2026-12-01, and Wait for CI has no key in any config.

Wait for CI can't be told which checks to wait for: it waits for every GitHub Actions check suite on the commit, and skips the deploy if any fails ("CI check suite failed"). So CI is the only thing that may run Actions on `main`'s commits. Anything else that does, a scheduled workflow included, can stop a deploy whose code passed CI. This is why Dependabot's security updates are off and only its alerts are on (#134): its update jobs run as Actions on `main`'s latest commit, and fail for any alert it can't fix, as for a transitive dependency. A failed job says nothing about the code, yet it blocks the deploy, even one fixing the vulnerability the job was about. Alerts run no Actions, and the updates stay off (#135): alerts are cleared by hand, as [Dependency alerts](#dependency-alerts) says.

Applied migrations are never edited or deleted, and `migrate dev` never runs in production. The seed refuses to run there: it would create an account with a known password.

## Inviting someone

Add their email to `SIGNUP_ALLOWED_EMAILS` on Railway, comma-separated, with no code change. The API reads it from its environment, so the invitation counts once the API has restarted with the new value. Then they sign up at `study.beaudavenport.com` with that email; anyone else is told signup is by invitation.

An invitation doesn't include AI. To give someone AI too, add them to `AI_ALLOWED_EMAILS` as well. Removing an email from the signup allowlist stops it signing up, and doesn't touch an account it already made.

In dev, signing up needs the same variable in `.env`, listing the email you sign up with, and an API restarted since you added it. The seed's account, `dev@example.com`, needs nothing: it's created directly and logs in as usual.

## Backups

Railway backs up the database itself, on its Pro plan: Hobby can only view and restore backups, not make them. Pro is $20 a month including $20 of usage, with the hard limit at $20 so the bill stays there, and an email alert at $12 (#133). Both are in the Postgres service's Backups tab:

- **Volume backups**, on a schedule of daily (kept 6 days), weekly (kept 27) and monthly (kept 89), or by hand with New backup. They're incremental, billed as volume storage.
- **Point-in-time recovery**, which archives Postgres's write-ahead log to the `Postgres-PITR` bucket, so the database can go back to a chosen moment, like just before a bad `UPDATE`.

They live in Railway, so they don't survive the project: deleting a volume deletes its backups.

**Restoring a volume backup** goes back over the database in place. There's no restoring into a scratch database, so be sure first, and take a New backup if the current state might be wanted.

1. In the Backups tab, Restore the backup. It becomes a new volume at the same mount path, and the old one stays, unattached. Nothing changes yet: the restore is staged.
2. Details on the project canvas lists the staged changes. Check the volume being attached is the backup's, then Deploy Changes, which asks for 2FA. Postgres redeploys.
3. The dashboard can keep spinning: reload it. Check with `railway connect postgres` and a count, and log in.
4. Backups taken after the restored one stay on the old volume. Delete it only once the new one has a backup of its own: New backup, or wait for the schedule.

This was done once on 2026-11-09, while production held only the maintainer's account, and the app worked against the restored volume. A point-in-time restore hasn't been tried.

## Logs and error reports

The API writes JSON lines to stdout, which Railway keeps. In dev they appear in the terminal running it.

- **Every request** logs one line, once it's over: `method`, `route`, `userId` when logged in, `status` and `durationMs`. Expected refusals, such as a wrong password or a rate limit, show here with their status and go no further. A request refused by the limit on every request shows no user, as it's refused before anyone is looked up, and a tutor reply that fails part-way shows `200`, as its status has already gone.
- **A server error** logs a second line, `"level":"error"`, with the tRPC `procedure`, its `code` and the `errorName`.

Logs never hold a body, an answer, a password, a cookie, a token or a query string. `route` is the path alone, as a query string can hold a procedure's input. An error's message stays out too, as it can quote what caused it, as a body that won't parse does. The API answers those itself, so Express doesn't print them to stderr.

Every server error is also reported to Sentry, with its message and stack, the procedure and the code, including a tutor reply that fails part-way. Nothing about the request goes with it: the integrations that would attach one are off. The message can still quote what caused it, so treat Sentry as private.

The web app reports uncaught errors and React render errors to Sentry, including those an error screen catches, with the page's URL. It sends crashes alone: no breadcrumbs, as they'd keep the URLs fetched, which hold tRPC inputs, no console messages and no session pings.

Both sides send nothing while their DSN is unset, so dev and tests never report. Two things aren't reported. A crash outside a request, such as one in the process itself, shows in Railway's logs as the API restarts. And when a tutor reply fails after the learner has left, nobody is reading it, so it goes unseen and that exchange is lost.

## Limits

| What          | Limit                                             | Past it                                    |
| ------------- | ------------------------------------------------- | ------------------------------------------ |
| Logging in    | 10 per email and 30 per address, every 15 minutes | Told to wait, even with the right password |
| Signing up    | 10 per address, every 15 minutes                  | Told to wait                               |
| Every request | 300 a minute per address                          | HTTP 429                                   |

Limits are counted in memory, in the one API process, so restarting it clears them all. That's also the fix if someone is locked out and can't wait. Anyone can use up an email's 10 logins by guessing, which locks that person out too, for as long as the guessing goes on. That's accepted for an invite-only app: it's what stops the guessing.

Two gaps are accepted. One HTTP request counts once, however many calls it batches: anyone without an account can only reach cheap calls, and logging in and signing up count each call. And an address is matched whole, so a client with a block of IPv6 addresses could spread its attempts across them, though the limit per email still holds.

The address is `X-Real-IP`, which Railway documents as the client's remote IP. `X-Forwarded-For` is left alone: Railway doesn't document it, and a client can write to it. Railway doesn't document whether a client's own `X-Real-IP` is replaced either, so check on the live API after the first deploy, from a connection with no signups in the last 15 minutes:

```sh
for i in $(seq 1 11); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.study.beaudavenport.com/trpc/auth.signup \
    -H 'content-type: application/json' -H "X-Real-IP: 203.0.113.$i" \
    -d '{"email":"nobody@example.com","password":"password123"}'
done
```

Ten `403`s and then a `429` means the forged addresses were ignored. Eleven `403`s means a client can pick its own address, so the limits per address can be dodged, though the limit per email still holds.

Then run one more signup right away from another network, such as a phone's hotspot. A `403` means addresses are counted apart. A `429` means every client shares one address, so one person could lock out everyone: `X-Real-IP` isn't reaching the API, or `NODE_ENV` isn't `production`. Fix either failure before relying on the limits.

## Dependency alerts

Dependabot's alerts are on and its security updates off, as [How a deploy runs](#how-a-deploy-runs) says. Clear an alert by hand, most of them being for transitive dependencies:

1. `pnpm update -r`, which updates every dependency within its range, then `pnpm audit` to see what's left. It reads the same advisories as Dependabot.
2. For what's left, take a newer version of the direct dependency that pulls it in, a major one at a time.
3. Only then a pnpm override in `package.json`, listed here with why it's there and when it can go. There are none now.
4. An alert for code production never runs, like lint's, can be dismissed in GitHub instead, saying so.

Typecheck, lint, both test suites and the web build must pass, and the study, lesson and tutor flows still work, before it goes to `main`. Updated tooling can lint or format differently: fix what it finds in the same commit.

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

2. Connect to the production database with `railway connect postgres`, which needs the Railway CLI, linked to the project, and `psql` on your laptop. Postgres has no public address, so it tunnels over SSH, with a key registered with your Railway account and held by your SSH agent. Without the agent, `ssh` runs where it can't ask for the key's passphrase, and the tunnel times out. Once per laptop, make a key for Railway alone, then add it to the agent:

   ```sh
   ssh-keygen -t ed25519 -C "railway study-hall" -f ~/.ssh/id_ed25519_railway
   ssh-add --apple-use-keychain ~/.ssh/id_ed25519_railway
   ```

   The first `railway connect postgres` offers to register it. Register no other key. A restart empties the agent: run the `ssh-add` again, which takes the passphrase from the keychain.

3. Set the hash, single quotes around it, and clear that user's login sessions, which logs them out on every device. The email is stored in lowercase, so write it that way.

   ```sql
   UPDATE "User" SET "passwordHash" = '<the hash>', "updatedAt" = now() WHERE email = '<their email>';
   DELETE FROM "Session" WHERE "userId" = (SELECT id FROM "User" WHERE email = '<their email>');
   ```

   `UPDATE 1` means it found the account. `UPDATE 0` means the email didn't match, and nothing changed.

4. Log in with the new password.
