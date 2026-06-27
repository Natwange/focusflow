# FocusFlow

FocusFlow is a full-stack productivity app that helps users break goals into actionable tasks, track focus sessions, and stay on track with an AI assistant. The project emphasizes practical product engineering, secure backend design, and tool-backed agent actions (not chat-only responses).

## Live app

| Service | URL |
|--------|-----|
| **Web app** | [https://focusflow-client.onrender.com/](https://focusflow-client.onrender.com/) |
| **API** | [https://focusflow-server-y490.onrender.com/](https://focusflow-server-y490.onrender.com/) |

Health check: `GET https://focusflow-server-y490.onrender.com/health` → `{ status, mem0, composio, authCookies, ... }`.

## Project overview

FocusFlow combines:

- **Goal planning** — deadline-aware task generation, unit-scoped chunks (lessons/chapters), weekday caps, rebalance/adjustment previews, and goal-agent insights
- **Task management** — priorities, due dates, scheduled time blocks, day/week/month views, overdue labeling
- **Focus sessions** — Pomodoro-style timer with a global widget, session logging, streaks, and analytics
- **Oti (AI agent)** — floating “Ask Oti” chat that calls validated backend tools (tasks, goals, focus, memory, integrations)
- **Long-term memory (Mem0)** — per-user preferences (study times, focus length, workload limits) scoped by user id
- **External integrations (Composio)** — Gmail, Google Calendar, and Notion via OAuth (agent tools; connect flow on API)
- **Journal & reflection** — full notes with autosave plus a daily reflection draft
- **Analytics** — productivity trends and activity-pattern insights
- **Secure auth** — HttpOnly cookie sessions with refresh rotation, idle timeout, and optional same-origin BFF proxy

## Core features

### Productivity

- **Dashboard** — today’s tasks, streak, agent suggestions, shortcuts, and a “Today’s Plan” overlay
- **Goals** — create/update/delete; plan preview/confirm; rebalance and adjustment flows; **OVERDUE** badges on past-due plan sections; linked tasks store **unit ranges** (`unitStart`–`unitEnd`)
- **Goal agent** — evaluation, failure hints, rebalance previews; **apply rebalance/adjustment** with confirmation; history stored as **`AgentRun`** rows
- **Tasks** — `todo` / `doing` / `done`; calendar day timeline with scheduled blocks; overdue indicators
- **Focus** — start/pause/stop sessions; global timer widget (bottom-left); sessions logged for analytics
- **Journal** — note list, Today’s Reflection (local draft), rich note editor with font styles
- **Analytics** — charts and `GET /analytics/activity-patterns` habit insights

### Oti (AI agent)

- **UI** — fixed “Ask Oti” pill (bottom-right); right-docked chat panel; blurs with modals (Settings, Today’s Plan)
- **Backend** — `POST /agent/chat` with LLM tool-calling (OpenAI or Anthropic); rule-based fallbacks when unconfigured
- **Tools** — list/create/update/complete/delete tasks; goals and plan confirm/rebalance/adjust; focus suggestions; proactive suggestions; adaptive recommendations; Mem0 remember/recall/forget
- **Integrations tools** — calendar events, Gmail send/draft, Notion pages/goal export (require Composio connection)
- **Orchestrator** — `AGENT_ORCHESTRATOR=custom` (default) or `langgraph` for LangGraph-based flow
- **Session isolation** — chat state clears on logout and when the signed-in user changes

### Account & settings

- Register, login, refresh, logout, password change, forgot password, email verification
- **Settings modal** — account (email, password, sign out) and appearance (light / dark / system)
- **Session inactivity** — 60-minute idle warning, then auto sign-out (paused during active focus sessions)

## Tech stack

| Layer | Stack |
|-------|--------|
| **Frontend** | Next.js 16 (App Router), React 18, TypeScript, Tailwind CSS v4 |
| **Backend** | Node.js 20+, Express 5 |
| **Database** | PostgreSQL, Prisma 7 |
| **Auth** | JWT in HttpOnly cookies, refresh token rotation, helmet, CORS, rate limiting, Zod, sanitize-html |
| **Agent** | OpenAI and/or Anthropic SDKs; optional LangGraph; rule-based parser for common intents |
| **Memory** | [Mem0](https://mem0.ai) (`mem0ai`) — namespaced per FocusFlow user |
| **Integrations** | [Composio](https://composio.dev) — Gmail, Google Calendar, Notion |
| **Email** | Resend (password reset + verification) |
| **Testing** | Jest + Supertest |

**UI:** Shared app canvas (`.ff-page`), card-based layouts, dark mode via `ThemeProvider` and `localStorage`.

## Architecture

```
focusflow/
├── client/                 # Next.js UI
│   ├── app/                  # App Router pages + /api/bff proxy + /api/config
│   ├── components/           # AgentChat, Navbar, settings, analytics, focus timer
│   └── lib/                  # api, agent events, calendar dates, focus timer storage
├── server/
│   ├── prisma/               # schema + migrations
│   └── src/
│       ├── agent/            # chat orchestrator, LLM client, tools, rule parser
│       ├── memory/           # Mem0 service + extraction
│       ├── integrations/     # Composio client, OAuth, tool runners
│       ├── routes/           # auth, goals, tasks, journal, focus, analytics, agent, integrations
│       └── lib/              # planning, goal agent, auth, ownership, sanitization
└── render.yaml               # Render Blueprint (API service)
```

**API routing (production):**

- **Direct API** — browser calls Express on a separate host (`NEXT_PUBLIC_API_URL`). May need `COOKIE_SAME_SITE=none` on mobile.
- **BFF proxy** — browser calls same-origin `/api/bff/*`; Next forwards to Express (`BACKEND_URL`). Cookies stay first-party (recommended for split Render hosts).
- **Hybrid auth** — optional direct API for authenticated routes with runtime config from `GET /api/config` (`HYBRID_AUTH_ROUTING`, `BACKEND_URL`).

## Security

- HttpOnly cookie auth; refresh token rotation
- Protected routes with ownership checks on tasks, goals, journal, agent, integrations
- Zod validation on API inputs
- Per-email auth rate limits (register, forgot password, refresh)
- Sanitized user-generated text; JSON audit events for auth actions
- Composio connect state signed with `JWT_SECRET`; sensitive values redacted in logs

## Testing

Backend tests cover goal planning, agent tools, Mem0, Composio mocks, auth/security flows, and integration routes.

```bash
cd server
npm test
```

## Run locally

### Prerequisites

- Node.js 20+
- npm
- PostgreSQL

### 1) Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2) Environment variables

**`server/.env`** (required):

```env
DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<db>"
JWT_SECRET="<long-random-secret>"
CLIENT_ORIGIN="http://localhost:3000"
JWT_EXPIRES_IN="7d"
```

**Optional — database (Supabase / pooler):**

```env
# DATABASE_URL_DIRECT="postgresql://..."   # for prisma migrate; see server/prisma.config.ts
```

**Optional — email (Resend):**

```env
RESEND_API_KEY="re_..."
EMAIL_FROM="FocusFlow <noreply@yourdomain.com>"
PUBLIC_APP_URL="http://localhost:3000"
```

**Optional — Oti agent (at least one LLM key):**

```env
OPENAI_API_KEY="sk-..."
# ANTHROPIC_API_KEY="..." or CLAUDE_API_KEY="..."
# AGENT_PROVIDER="openai" | "anthropic"   # auto-detected if omitted
# AGENT_MODEL="gpt-4o-mini"
# AGENT_ORCHESTRATOR="custom" | "langgraph"
```

**Optional — Mem0 long-term memory:**

```env
MEM0_API_KEY="..."
# MEM0_MEMORY_LIMIT="6"
# MEM0_MEMORY_THRESHOLD="0.35"
```

**Optional — Composio integrations:**

```env
COMPOSIO_API_KEY="..."
PUBLIC_API_URL="http://localhost:4000"    # OAuth callback base (production: your API HTTPS URL)
COMPOSIO_AUTH_CONFIG_GMAIL="..."
COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR="..."
COMPOSIO_AUTH_CONFIG_NOTION="..."
# COMPOSIO_BASE_URL="https://backend.composio.dev"
```

**Optional — auth / cookies / limits:**

```env
# JWT_ACCESS_EXPIRES_IN="15m"
# JWT_REFRESH_EXPIRES_IN="7d"
# TRUST_PROXY="1"
# COOKIE_SAME_SITE="none"          # cross-origin web + API in production
# DISABLE_AUTH_RATE_LIMIT="1"      # emergency only
# REGISTER_RATE_LIMIT_MAX="50"
# FORGOT_PASSWORD_RATE_LIMIT_MAX="20"
```

**`client/.env.local`:**

```env
NEXT_PUBLIC_API_URL="http://localhost:4000"
```

**Production BFF (same-origin cookies):**

```env
NEXT_PUBLIC_API_URL="https://your-next-host.onrender.com/api/bff"
BACKEND_URL="https://your-api-host.onrender.com"
```

**Production hybrid direct API (optional):**

```env
NEXT_PUBLIC_API_URL="https://your-next-host.onrender.com/api/bff"
NEXT_PUBLIC_DIRECT_API_URL="https://your-api-host.onrender.com"
HYBRID_AUTH_ROUTING="1"
```

### 3) Run migrations

```bash
cd server
npx prisma migrate dev
```

### 4) Start apps

```bash
# terminal 1
cd server && npm run dev

# terminal 2
cd client && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying

FocusFlow is **two deployables** (Next.js + Express) plus **PostgreSQL**. Production uses **Supabase** (database) and **Render** (web + API).

### Database

1. Set **`DATABASE_URL`** on the API service.
2. Use **`DATABASE_URL_DIRECT`** for migrations if the app uses a pooler URL (`server/prisma.config.ts`).
3. Run migrations: `npx prisma migrate deploy` (also in Render build via `render.yaml`).

### API (Render — `server/`)

- **Build:** `npm install --legacy-peer-deps && npm run build && npx prisma migrate deploy`
- **Start:** `npm start`
- **Required:** `DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN` (exact frontend URL, no trailing slash)
- **Recommended:** `TRUST_PROXY=1`, `PUBLIC_API_URL` (API public HTTPS URL for Composio OAuth)
- **Split hosts:** `COOKIE_SAME_SITE=none` unless using the BFF proxy

### Frontend (Render — `client/`)

- **Build:** `npm install && npm run build`
- **Start:** `npm start`
- Prefer **BFF** (`NEXT_PUBLIC_API_URL=.../api/bff` + `BACKEND_URL`) for reliable cookies on mobile

### Smoke checks

- `GET /health` — `mem0.configured` and `composio.configured` reflect optional keys
- Sign up / log in from the live site; dashboard loads with streak and tasks
- Open Oti, ask “what are my tasks today?” — agent responds with tool-backed data

## Screenshots

_Add screenshots/gifs here: dashboard, goals planner, tasks timeline, Oti chat, focus timer, analytics, journal._

## Roadmap

- Settings UI for Composio connect (Gmail, Calendar, Notion)
- Cross-tab session sync for Oti chat reset on account switch
- CI pipeline with automated test runs
- E2E tests for login, goals, and agent flows
- Optional server-backed daily reflection persistence
