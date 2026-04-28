# FocusFlow

FocusFlow is a full-stack personal productivity app for:
- turning goals into dated task plans
- tracking focus sessions (Pomodoro-style)
- monitoring streak + productivity analytics
- keeping journal notes

This README describes what is currently implemented in this repository.

## What Is In The App Right Now

### Core product areas
- Auth: register, login, logout, cookie-based session with refresh token rotation
- Dashboard: today's task view (includes overdue), focus minutes today, streak
- Goals: create/edit/delete goals, generate plan previews, confirm plan into tasks, rebalance overdue plans
- Tasks: create/edit/delete tasks, status updates, priority + due date/time, week/month/day calendar views
- Focus: persistent timer (survives tab navigation), session logging, session stats
- Analytics: day/week/month dashboard with productivity score and chart data from live DB values
- Journal: create/read/update/delete personal notes
- Settings: account panel, password change, sign out, theme preference (light/dark/system)
- Assistant UI: rule-based in-app assistant shell (currently non-LLM)

### Main frontend routes
- `/login`, `/signup`
- `/dashboard`
- `/goals`
- `/tasks`
- `/focus`
- `/analytics`
- `/journal`, `/journal/[noteId]`
- `/settings`
- `/plans/today` (placeholder: "Coming Soon")

## Tech Stack

### Frontend (`client`)
- Next.js (App Router) + React + TypeScript
- Tailwind CSS
- `lucide-react` icons
- API calls use `fetch` with cookie credentials

### Backend (`server`)
- Node.js + Express
- Prisma + PostgreSQL
- JWT access token in `httpOnly` cookie + opaque refresh token rotation
- Cookie auth middleware for protected routes

## Repository Structure

- `client` - Next.js app
- `server` - Express API + Prisma schema/migrations
- `server/prisma/schema.prisma` - database models
- `server/src/routes` - API route modules

## Data Model (Current)

Main Prisma models:
- `User`
- `RefreshToken`
- `Goal`
- `Task`
- `FocusSession`
- `JournalNote`

Notable behavior:
- User streak is visit-based (updated via `POST /activity/ping`)
- Goal planning supports weighted units and deadline-inclusive scheduling
- Goal rebalancing keeps completed tasks and regenerates remaining plan tasks

## API Surface (Current)

### Public routes
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /health`

### Authenticated routes
- `GET /me`
- `PATCH /me/password`
- Goals: CRUD + planning (`/goals`, `/goals/:id/plan/preview|confirm|refresh`)
- Tasks: CRUD + status updates (`/tasks`, `/tasks/:id`, `/tasks/:id/status`)
- Focus: create/list/stats/summary (`/focus`, `/focus/stats`, `/focus/summary`)
- Analytics: `/analytics/overview`, `/analytics/productivity`, `/analytics/dashboard`
- Journal notes: `/journal/notes`, `/journal/notes/:id`
- Activity ping: `POST /activity/ping`

## Local Development

### Prerequisites
- Node.js 20+
- npm
- PostgreSQL database (local or hosted)

### 1) Install dependencies

In two terminals:

```bash
cd server
npm install
```

```bash
cd client
npm install
```

### 2) Configure environment variables

Create `server/.env`:

```env
DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<db>"
JWT_SECRET="<long-random-secret>"
JWT_EXPIRES_IN="7d"
CLIENT_ORIGIN="http://localhost:3000"
# Optional:
# JWT_ACCESS_EXPIRES_IN="15m"
# JWT_REFRESH_EXPIRES_IN="7d"
# PORT="4000"
```

Create `client/.env.local`:

```env
NEXT_PUBLIC_API_URL="http://localhost:4000"
```

### 3) Run Prisma migrations

```bash
cd server
npx prisma migrate dev
```

### 4) Start both apps

Backend:

```bash
cd server
npm run dev
```

Frontend:

```bash
cd client
npm run dev
```

Open `http://localhost:3000`.

## Scripts

### Client
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`

### Server
- `npm run dev`
- `npm run start`

## Important Notes / Current Limits

- The in-app assistant is currently rule-based placeholder logic, not a production AI backend.
- `/plans/today` exists but is not implemented beyond a placeholder page.
- There is no automated test suite configured yet in this repo.
- `client/app/layout.tsx` metadata still has default Next.js title/description values.

## Health Check

- Backend: `GET http://localhost:4000/health`
- Expected: `{ "status": "ok", "time": "..." }`
