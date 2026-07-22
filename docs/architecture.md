# FocusFlow Architecture

FocusFlow is a full-stack productivity app: users manage goals and tasks, log focus sessions, journal, and chat with **Oti**, an in-app agent that can plan schedules, remember preferences, and call external tools (Calendar, Gmail, Notion) with confirmation.

## System overview

```text
┌─────────────────┐     same-origin /api/bff/* (prod)      ┌─────────────────┐
│  Next.js client │ ─────────────────────────────────────► │  Express API    │
│  (App Router)   │     or direct API URL (local)          │  (Node / Express)│
└─────────────────┘                                        └────────┬────────┘
                                                                    │
                                          ┌─────────────────────────┼─────────────────────────┐
                                          ▼                         ▼                         ▼
                                   PostgreSQL (Prisma)        LLM (OpenAI / Anthropic)   External APIs
                                   Supabase in production     Mem0 preferences           Composio, Resend
```

| Layer | Role |
|--------|------|
| **Client** | Next.js UI, session cookies via `credentials: "include"`, optional BFF proxy |
| **API** | Express routes for auth, goals, tasks, focus, journal, analytics, agent, integrations |
| **Database** | PostgreSQL via Prisma (goals, tasks, sessions, agent runs, tokens) |
| **Agent** | Tool-calling orchestrator (custom or LangGraph) + deterministic goal planning engines |
| **Externals** | Mem0 (preferences), Composio (Gmail / Calendar / Notion), Resend (email), LLM providers |

Production deploys as **two services** (web + API) plus Postgres, typically on Render with Supabase-hosted Postgres.

## Repository layout

```text
focusflow/
├── client/                 # Next.js App Router + TypeScript + Tailwind
│   ├── app/                # Pages + /api/bff (proxy) + /api/config
│   ├── components/         # UI including AgentChat, settings, analytics
│   └── lib/                # API client, auth helpers, agent events
├── server/                 # Express API
│   ├── prisma/             # Schema + migrations
│   ├── src/
│   │   ├── agent/          # Chat orchestration, tools, LLM client
│   │   ├── memory/         # Mem0 preference memory
│   │   ├── integrations/   # Composio OAuth + toolkit tools
│   │   ├── routes/         # HTTP route modules
│   │   ├── lib/            # Planning, goal agent, auth, analytics helpers
│   │   ├── middleware/     # Auth + Zod validation
│   │   └── validation/     # Request schemas
│   └── tests/
├── docs/                   # Project documentation (this folder)
└── README.md
```

## Client architecture

- **App Router pages** for dashboard, goals, tasks, focus, journal, analytics, auth, settings.
- **API access** through `client/lib/api.ts` with cookie credentials. On `401`, the client tries `/auth/refresh` and retries.
- **BFF proxy** (`/api/bff/*`) forwards browser requests to Express (`BACKEND_URL`) so auth cookies stay first-party when the web and API hosts differ.
- **Agent chat UI** posts to `/agent/chat`; mutations can emit client events so lists refresh after tool writes.

## Server architecture

`server/src/app.js` composes middleware (helmet, CORS, cookies, JSON) and mounts domain routers. Most product routers require an authenticated access cookie. Auth routes and health are public (see [api.md](./api.md)).

### Auth (session model)

- **Access token**: short-lived JWT in an HttpOnly cookie.
- **Refresh token**: opaque token in an HttpOnly cookie; only a hash is stored in the database. Refresh **rotates** the token.
- Passwords are hashed with bcrypt. Password-reset and email-verify use single-use opaque tokens.
- Ownership checks ensure users only read/write their own goals, tasks, notes, and agent data.

### Domain logic highlights

| Area | Responsibility |
|------|----------------|
| **Goals / planning** | Deadline-aware unit plans (`buildPlan`), preview/confirm, rebalance strategies |
| **Goal agent (deterministic)** | Progress evaluation, failure modes, rebalance recommendations, `AgentRun` history |
| **Adaptive recommendations** | Rank next actions using goal state, behavior signals, and strategy outcome memory |
| **Tasks / focus / journal** | CRUD and summaries scoped to the signed-in user |
| **Analytics / activity** | Productivity series, activity patterns, visit streak pings |

### Agent (Oti)

Chat entry point: `POST /agent/chat` → `chatOrchestrator.run()`.

1. Build soft **Mem0** preference context for the turn (if configured).
2. Handle shortcuts (confirmations, remember / recall / forget, rule-based intents).
3. Call the LLM with at most **one tool per turn**, or fall back to rules if no LLM keys.
4. Validate tool args (Zod), execute via `toolExecutor`, return grounded replies.
5. Optionally auto-extract stable preferences into Mem0.

Orchestrator mode:

- `AGENT_ORCHESTRATOR=custom` (default): imperative tool loop.
- `langgraph`: LangGraph state machine reusing the same tool execution helpers.

**Mem0** stores long-term *preferences* (study habits, focus length). It is separate from **strategy memory** (`AgentRun` outcomes), which personalizes rebalance-style recommendations from measured completion / missed-task deltas.

**Composio** tools require connected accounts; write actions (send email, create calendar events, create Notion pages) use preview → confirm flows.

## Data model (Prisma)

| Model | Purpose |
|-------|---------|
| `User` | Account, verification, streak fields |
| `RefreshToken` | Hashed refresh sessions |
| `OpaqueAuthToken` | Password reset / email verify tokens |
| `Goal` | Unit-based goals with deadline and schedule constraints |
| `Task` | Tasks with optional goal link, schedule, unit ranges |
| `AgentRun` | Goal-agent history and outcome learning fields |
| `FocusSession` | Logged focus intervals |
| `JournalNote` | Journal notes |
| `ComposioConnection` | Which toolkits the user connected (tokens stay with Composio) |

## Deploy & configuration

- **API**: Express service; migrations typically run on start/build (`prisma migrate deploy`).
- **Web**: Next.js service; may set `NEXT_PUBLIC_API_URL` to `/api/bff` in production.
- **Database**: `DATABASE_URL` for the app; optional `DATABASE_URL_DIRECT` for migrations behind a pooler.
- Feature flags for Mem0 / Composio / LLM are driven by environment variables on the API (never commit secrets).

## Related docs

- [API reference](./api.md) — HTTP endpoints and responsibilities
- Root [README.md](../README.md) — setup, deploy, and feature overview
