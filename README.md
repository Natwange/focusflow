# FocusFlow

FocusFlow is a full-stack productivity app that helps users break goals into actionable tasks, track focus sessions, and reflect through journal notes and a lightweight daily reflection flow. The project emphasizes practical product engineering and secure backend design.

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

## Architecture Overview

- `client/` - Next.js UI and page routes
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
JWT_SECRET="<long-random-secret>"
CLIENT_ORIGIN="http://localhost:3000"
JWT_EXPIRES_IN="7d"
# Optional
# JWT_ACCESS_EXPIRES_IN="15m"
# JWT_REFRESH_EXPIRES_IN="7d"
# AUTH_RATE_LIMIT_MAX="8"
# PORT="4000"
# TRUST_PROXY="1"
```

Create `client/.env.local`:

```env
NEXT_PUBLIC_API_URL="http://localhost:4000"
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

FocusFlow is two deployables (Next.js `client/` + Express `server/`) and a **PostgreSQL** database. A common setup is **frontend on Vercel** and **API on Railway, Render, or Fly.io** with a managed Postgres (Neon, Supabase, Railway Postgres, etc.).

### Database

1. Create a Postgres database and set `DATABASE_URL` on the server (same shape as local).
2. Run migrations against production (from `server/`):

```bash
npx prisma migrate deploy
```

Also run `npx prisma generate` during your API build or install if the host does not do it automatically.

### API (Express)

- Set **`NODE_ENV=production`**.
- **`JWT_SECRET`**: long random string.
- **`CLIENT_ORIGIN`**: your live site origin, exact scheme + host (no trailing slash), e.g. `https://my-app.vercel.app`. Multiple origins: comma-separated list.
- **`PORT`**: whatever the platform assigns (often automatic).
- **`TRUST_PROXY=1`** when the app sits behind a reverse proxy (Railway, Render, etc.) so rate limits and IPs behave.
- **Split frontend/API domains:** the browser calls the API on a different site than the page, so set **`COOKIE_SAME_SITE=none`** so HttpOnly auth cookies are sent on credentialed `fetch` (HTTPS required). Same hostname for both can omit this and keep the default **strict** cookies.

Start command: `npm run start` from `server/` after `npm install` and Prisma generate/migrate.

### Frontend (Next.js)

- **`NEXT_PUBLIC_API_URL`**: public API base URL, e.g. `https://your-api.up.railway.app` (no trailing slash).
- Build: `npm run build` → `npm run start` (or use the host’s Next.js preset).

### Render (API)

This repo has no root `package.json`; the API lives under **`server/`**.

- **Root Directory** (Dashboard): `server`
- **Build Command**: `npm ci && npm run build` (runs `prisma generate` + `prisma migrate deploy`; needs **`DATABASE_URL`** available at build time — add it under *Environment* and enable it for builds if Render asks)
- **Start Command**: `npm start`
- Optional: connect the repo and use the root **`render.yaml`** Blueprint as a starting point

The API binds to **`0.0.0.0`** so Render’s health checks and routing work.

### Smoke checks

- Open `GET {API}/health` — should return JSON `status: ok`.
- From the deployed site, sign up / log in; if login succeeds but data calls fail with 401, confirm **`CLIENT_ORIGIN`** matches the browser origin and **`COOKIE_SAME_SITE=none`** when API and web run on different hosts.

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
