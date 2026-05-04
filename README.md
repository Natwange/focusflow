# FocusFlow

FocusFlow is a full-stack productivity app that helps users break goals into actionable tasks, track focus sessions, and reflect through journal notes and a lightweight daily reflection flow. The project emphasizes practical product engineering and secure backend design.

## Live app

**Production (Render):** [https://focusflow-client.onrender.com/](https://focusflow-client.onrender.com/)

## Project Overview

FocusFlow combines:
- goal planning with deadline-aware task generation, unit-scoped chunks (lessons/chapters), and optional goal-agent insights (progress evaluation, failure hints, rebalance previews)
- task management with priorities, due dates, status, and calendar-style day/week/month views
- focus session logging and streak analytics
- journaling with a daily reflection prompt (local draft) plus full-page notes with autosave
- analytics for productivity trends and activity-pattern summaries
- secure cookie-based authentication

## Core Features

- Account system: register, login, refresh, logout, password change
- Goals: create/update/delete; plan preview/confirm and rebalance flows; optional **max units per day** and **available weekdays**; linked tasks store **unit ranges** (`unitStart`–`unitEnd`) so completion progress is measured in goal units (e.g. lessons), not only the number of tasks
- Goal agent: preview endpoint combines evaluation, failure-style signals, and rebalance guidance; users can **apply agent rebalance**; results are stored as **`AgentRun`** rows for history and analytics
- Tasks: create/update/delete with priority, due date, and status (`todo` / `doing` / `done`); UI grouped by day, week, or month
- Journal: note list with **Today’s Reflection** (optional prompts, per-day draft in `localStorage`) plus create/read/update/delete notes with font style preferences
- Focus sessions: log sessions, summarize daily time and streak
- Analytics: productivity metrics and charts; **`GET /analytics/activity-patterns`** drives habit-focused insights on the analytics page; dashboard-oriented aggregates where exposed
- Dashboard: shortcuts into goals (planner), focus, and other primary flows

## Tech Stack

- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS
- **Backend:** Node.js, Express
- **Database:** PostgreSQL with Prisma ORM
- **Auth/Security:** JWT in HttpOnly cookies, refresh token rotation, helmet, CORS, rate limiting, Zod, sanitize-html
- **Testing:** Jest + Supertest

**UI:** Shared light-gray app canvas (`.ff-page` in `client/app/globals.css`) and white cards with soft borders/shadows on primary pages (dashboard, goals, journal, tasks, analytics, auth).

## Architecture Overview

- `client/` - Next.js UI and page routes
- `client/app/api/bff/[[...path]]/route.ts` - optional **same-origin API proxy** (server-side forward to Express). Use in production when the web app and API are on different hosts so auth cookies stay **first-party** on the Next.js domain (fixes strict mobile browsers blocking cross-site cookies).
- `server/prisma.config.ts` - Prisma CLI config (migrations): prefers **`DATABASE_URL_DIRECT`** when set, otherwise **`DATABASE_URL`** (helpful with Supabase pooler + direct URLs).
- `server/src/app.js` - Express app composition (middleware + routes)
- `server/src/index.js` - server bootstrap/listener startup
- `server/src/routes/` - API route modules (`auth`, `goals`, `tasks`, `journal`, `focus`, `analytics`, `activity`)
- `server/src/lib/` - shared logic (auth sessions, **`buildPlan`** planning, **`evaluateGoalProgress`** / **`goalAgentOrchestrator`**, rebalance helpers, **`userActivityPatternAnalyzer`**, ownership checks, sanitization, audit logging)
- `server/tests/` - unit and integration/security test suites

## Security Improvements

- **HttpOnly cookie auth:** access and refresh tokens are set in HttpOnly cookies
- **Refresh token rotation:** refresh token is rotated on each valid refresh
- **Protected routes:** middleware-enforced auth on user data endpoints
- **Zod validation:** centralized request validation for auth/tasks/goals/journal inputs
- **Ownership checks:** user-scoped resource access controls for task/goal/journal updates/deletes
- **Rate limiting:** stricter limits on `/auth/login`, `/auth/register`, `/auth/refresh`
- **Sanitization:** user-generated text sanitized before persistence
- **Audit logging:** JSON audit events for login/logout/refresh/password-change actions

## Testing

Current automated coverage includes:
- **Unit tests**
  - Goal planning algorithm (`buildPlan`) behavior and edge cases
  - Goal progress evaluation (`evaluationEngine`), rebalance helpers, and related analyzers where covered
- **Integration tests**
  - Auth + `/me` behavior with cookie flow
  - Task validation and ownership boundaries
  - Goal routes (e.g. agent preview/run logging, apply rebalance) where present under `server/tests/integration/`
- **Auth/Security tests**
  - Login success/failure + cookie assertions
  - Refresh flow success/failure scenarios
  - Rate limiting assertions
- **Goal planning tests**
  - distribution correctness
  - deadline alignment
  - short/long-range edge cases
  - deterministic output
  - invalid input handling

Run backend tests:

```bash
cd server
npm test
```

## Run Locally

### Prerequisites

- Node.js 20+
- npm
- PostgreSQL

### 1) Install dependencies

```bash
cd server
npm install
```

```bash
cd client
npm install
```

### 2) Configure environment variables

Create `server/.env` (use your own real values):

```env
DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<db>"
# Optional (Supabase / pooler): use a direct or session URL for `prisma migrate` while the app uses a pooler URL above
# DATABASE_URL_DIRECT="postgresql://..."
JWT_SECRET="<long-random-secret>"
CLIENT_ORIGIN="http://localhost:3000"
JWT_EXPIRES_IN="7d"
# Optional
# JWT_ACCESS_EXPIRES_IN="15m"
# JWT_REFRESH_EXPIRES_IN="7d"
# AUTH_RATE_LIMIT_MAX="8"
# PORT="4000"
# TRUST_PROXY="1"
# COOKIE_SAME_SITE="none"   # only when web + API are on different origins in production (see Deploying)
```

Create `client/.env.local`:

```env
# Local: talk to Express directly
NEXT_PUBLIC_API_URL="http://localhost:4000"
# Production (optional BFF — see Deploying): same-origin proxy on the Next host, e.g.
# NEXT_PUBLIC_API_URL="https://your-next-host.onrender.com/api/bff"
# Plus on the Next service only (server-side): BACKEND_URL="https://your-api-host.onrender.com"
```

### 3) Run DB migrations

```bash
cd server
npx prisma migrate dev
```

### 4) Start apps

```bash
cd server
npm run dev
```

```bash
cd client
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying

FocusFlow is **two deployables** (Next.js `client/` + Express `server/`) plus **PostgreSQL**. The current production setup uses **[Supabase](https://supabase.com)** for the database and **[Render](https://render.com)** for both the web app and the API (each as its own Web Service).

Other stacks (e.g. Vercel + Railway) work too; env names stay the same.

### Database (Supabase or any Postgres)

1. Create a database and set **`DATABASE_URL`** on the API service (URI from the host, usually with `sslmode=require` or equivalent).
2. **Supabase tip:** you may use a **pooler** URL for the app and a **direct / session** URL for migrations. This repo supports **`DATABASE_URL_DIRECT`**: Prisma CLI (`migrate`) prefers it when set (see `server/prisma.config.ts`). The runtime app still uses **`DATABASE_URL`** via `server/src/lib/prisma.js`.
3. Migrations run on API startup: `npm start` in `server/` runs **`prisma migrate deploy`** then **`node src/index.js`**. You can also run manually from `server/`:

```bash
npx prisma migrate deploy
```

4. **`prisma generate`** runs during API `npm run build` (no DB connection required for generate).

**If deploy logs show Prisma `P1000` (authentication failed):** the username/password in **`DATABASE_URL`** (or **`DATABASE_URL_DIRECT`**) does not match the database — reset the DB password in Supabase, copy a fresh URI, URL-encode special characters in the password if you hand-edit the string, update Render env, redeploy.

A root **`render.yaml`** is included for Render Blueprints; you can still configure two Web Services manually in the dashboard (typical for this repo).

### API (Express) — e.g. Render service `focusflow-server`

- **Root Directory:** `server`
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`
- **`NODE_ENV=production`**
- **`JWT_SECRET`**: long random string (required).
- **`CLIENT_ORIGIN`**: your **exact** live web origin, e.g. `https://focusflow-client.onrender.com` (no trailing slash). Multiple origins: comma-separated.
- **`TRUST_PROXY=1`** behind Render’s proxy.
- **Different hostnames for web + API:** set **`COOKIE_SAME_SITE=none`** so HttpOnly cookies work on credentialed cross-origin `fetch` (HTTPS only). If you use the **BFF proxy** below, the browser only talks to the Next origin for API calls and you can rely on first-party cookies instead (recommended for mobile Safari/Chrome).

The process listens on **`0.0.0.0`** and **`PORT`** from the platform (e.g. `10000` on Render). Your **public** URL is the Render HTTPS hostname — not `http://0.0.0.0:PORT`.

### Frontend (Next.js) — e.g. Render service `focusflow-client`

- **Root Directory:** `client`
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`

**Option A — Direct API URL (simplest, can break on some mobile browsers when API is another site):**

```env
NEXT_PUBLIC_API_URL="https://your-api.onrender.com"
```

**Option B — Same-origin BFF (recommended when web and API are two Render URLs):**

Set on the **Next** service:

```env
NEXT_PUBLIC_API_URL="https://your-next-host.onrender.com/api/bff"
BACKEND_URL="https://your-api-host.onrender.com"
```

`BACKEND_URL` is **server-only** (not `NEXT_PUBLIC_*`). The route at `client/app/api/bff/[[...path]]/route.ts` forwards requests and rewrites `Set-Cookie` so session cookies are stored on the **web** domain.

### Smoke checks

- `GET https://<api-host>/health` → JSON `{ "status": "ok", ... }`.
- From the live site: sign up / log in, open dashboard. If you get sent back to login after a “successful” login, check **`CLIENT_ORIGIN`**, cookie env vars, and consider **Option B (BFF)** above.

## Screenshots

_Note to self: Add screenshots/gifs here_
- Dashboard
- Goals planner (saved plans, agent insight, rebalance)
- Tasks (day / week / month)
- Journal (reflection + notes)
- Journal note editor
- Analytics (productivity + activity patterns)

## Future Improvements

- Add CI test pipeline and coverage reporting
- Add centralized structured logging sink (Datadog/ELK) beyond console
- Expand e2e tests for key user journeys
- Add role/permission model for shared workspaces
- Optional server-backed persistence for daily reflections (or one-tap “save as note”)
- Extend goal agent with external LLM tooling when product requirements stabilize
