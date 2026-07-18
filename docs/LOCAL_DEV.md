# Local Dev - KitchFix Intranet

Get `npm run dev` running so you can watch live builds at
`http://localhost:3000/service-calendar?v2=1` (or any other surface).

> **THIS CONNECTS TO PRODUCTION.** Local dev points at the same
> Supabase database, the same Google service account, and the same
> auth provider as the deployed app on `main`. Reads are fine; any
> **save / entry / admin write made locally is a REAL production
> write**. Treat `http://localhost:3000` exactly as you'd treat
> `kitchfix-intranet.vercel.app`. There is no staging environment.

## Prerequisites

- **Node.js 20.9+** (Next.js 16 minimum; `package.json` pins
  `"next": "16.2.6"`, no separate `engines` field). Node 20 LTS or
  22 LTS is fine.
- **npm** (repo uses npm; no yarn / pnpm lockfile).
- A **Vercel dashboard login** with access to the KitchFix-Intranet
  project. You will copy env values out of there.
- **Google Cloud Console** access on the shared KitchFix workspace
  (needed once, to add the local redirect URI - see step 4).

## 1. Clone and install

```
git clone https://github.com/KitchFix-Intranet/kitchfix-intranet
cd kitchfix-intranet
npm install
```

## 2. Create `.env.local`

Copy the scaffold and fill in real values:

```
cp .env.example .env.local
```

Then open `.env.local` and paste values from Vercel:

- `https://vercel.com/` -> **KitchFix-Intranet** project
- **Settings** -> **Environment Variables**
- Copy the **Production** value for each var listed in `.env.example`
  under **REQUIRED-TO-BOOT**.

For local, override `AUTH_URL`:

```
AUTH_URL=http://localhost:3000
```

That is the only override; everything else copies verbatim from prod.

The rest of `.env.example` (Slack webhooks, external services,
optional flags) is per-surface. Leave a var empty and the
corresponding surface no-ops locally (Slack posts silent-fail,
Anthropic OCR passes through, etc.). Fill in only what you need to
exercise a specific flow.

`.env.local` is gitignored; the `.env.example` scaffold is the only
env file that ships in the repo.

## 3. Google OAuth: add localhost as an authorized redirect (one-time)

The shared Google OAuth client only accepts redirect URIs it knows
about. Prod is registered; localhost is not by default. Skipping
this step will land you on Google's error page reading
`redirect_uri_mismatch` after the sign-in click.

1. Google Cloud Console -> **APIs & Services** -> **Credentials**.
2. Open the OAuth 2.0 client that matches `GOOGLE_CLIENT_ID` in your
   `.env.local` (the same client prod uses).
3. Under **Authorized JavaScript origins**, add
   `http://localhost:3000` if not already present.
4. Under **Authorized redirect URIs**, add
   `http://localhost:3000/api/auth/callback/google` if not already
   present.
5. Save. The change is effective immediately.

The redirect URI path (`/api/auth/callback/google`) is fixed by
NextAuth v5's Google provider - do not change it.

## 4. Run the dev server

```
npm run dev
```

Next.js 16 uses Turbopack by default (no flag needed). The console
should read:

```
▲ Next.js 16.2.6 (Turbopack)
- Local:         http://localhost:3000
- Network:       http://10.0.0.x:3000
✓ Ready in ~200ms
```

A deprecation warning about `middleware.js -> proxy.js` is expected
and safe to ignore for now.

Open `http://localhost:3000` and sign in with your KitchFix Google
account.

## 5. Land on the Service Calendar with v2 on

```
http://localhost:3000/service-calendar?v2=1
```

- `?v2=1` persists a **v2 ON** override to localStorage.
- `?v2=0` clears the override.
- The `SC_ADMINS` gate applies locally exactly as in prod - if your
  email is not in that allowlist, you'll see the Coming Soon splash
  and the flag will not do anything visible.

Once loaded, drop the query param and the localStorage override
carries the flag across every subsequent navigation.

## 6. Watching live builds

Turbopack watches the entire working tree. Any edit to a file under
`src/`, `docs/design/sc-v2/`, or the CSS token layer hot-reloads in
the browser within a couple hundred ms.

- Uncommitted edits reload just fine. You do **not** need to commit
  or restart between iterations.
- A brief red error overlay mid-edit (an invalid state during typing)
  is expected. If it stays red after a save, it's a real error - the
  console log has the trace.
- Full-page browser refresh is rarely needed. If HMR feels stuck,
  try it before restarting the dev server.

## Troubleshooting

**First-boot: `[auth][error] MissingSecret` on the first page load.**
`AUTH_SECRET` is unset in `.env.local`. NextAuth v5 auto-discovers
it from the environment; without it every `auth()` call throws.
Fill in `AUTH_SECRET` from Vercel.

**Sign-in redirects to `redirect_uri_mismatch`.**
Step 3 was skipped or the wrong OAuth client was edited. Confirm
the `GOOGLE_CLIENT_ID` in your `.env.local` matches the client you
edited in Cloud Console.

**Any SC data route returns 500 with `Supabase env missing`.**
`SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is unset. SC reads
Supabase unconditionally (cutover flags don't gate SC's own reads);
both are required for `/service-calendar` to load.

**`EADDRINUSE: address already in use :::3000`.**
Another process is on port 3000. Either kill it
(`lsof -ti :3000 | xargs kill`) or start dev on a different port:
`npm run dev -- -p 3001`. Note that `AUTH_URL` and the Google
redirect URI will still both point at 3000 - you'll have to update
them both to use the new port for auth to work.

**Weird HMR errors, "module not found" ghosts, or the build seems
to be running old code.**
Stale `.next` cache. `rm -rf .next` then `npm run dev` again.

**Cron routes I hit locally don't fire scheduled work.**
Correct: the Vercel cron scheduler does not run in local dev. Cron
routes are just HTTP endpoints - they run when you request them.
Railway cron jobs (external service) also don't hit local dev.
None of the four `vercel.json` crons fire while `npm run dev` is
running.

**`main` protection error when trying to push a fix.**
Push to a feature branch and open a PR; direct pushes to `main`
are ruleset-blocked. See `CLAUDE.md` "Working agreement".

## What to know about production coupling

- Every save / write action on your local surface commits to
  production Supabase. There is no local database.
- The auth session cookie is domain-locked to `localhost:3000`, so
  logging into local does not affect your prod session (and vice
  versa).
- Slack webhooks fire against the real channels if filled in - if
  you exercise a flow that posts to Slack, someone will see it.
  Leave `SLACK_*` empty in `.env.local` to silence them.
- Cron routes are HTTP endpoints. Hitting `/api/cron/daily` locally
  runs the daily job against prod data. Don't do this by accident.
