# FocusFlow

FocusFlow is a full-stack productivity app that helps users break goals into actionable tasks, track focus sessions, and reflect with journal notes. The project emphasizes practical product engineering and secure backend design.

## Project Overview

FocusFlow combines:
- goal planning with deadline-aware task generation
- task management with priorities and status tracking
- focus session logging and streak analytics
- personal journaling with autosave
- secure cookie-based authentication

## Core Features

- Account system: register, login, refresh, logout, password change
- Goals: create/update/delete and generate/rebalance study/work plans
- Tasks: create/update/delete with priority, due date, and status
- Journal notes: create/read/update/delete with style preferences
- Focus sessions: log sessions, summarize daily time and streak
- Analytics dashboard: productivity metrics and trend views

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
- `server/src/lib/` - shared logic (auth sessions, planning, ownership checks, sanitization, audit logging)
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
- **Integration tests**
  - Auth + `/me` behavior with cookie flow
  - Task validation and ownership boundaries
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

## Screenshots

_Add screenshots/gifs here_
- Dashboard
- Goals planner
- Tasks calendar
- Journal detail editor
- Analytics page

## Future Improvements

- Add CI test pipeline and coverage reporting
- Add centralized structured logging sink (Datadog/ELK) beyond console
- Expand e2e tests for key user journeys
- Add role/permission model for shared workspaces
- Improve assistant capabilities with production LLM backend
