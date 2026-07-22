# FocusFlow API

HTTP API served by the Express app (`server/`). In production, browsers may call the same-origin BFF at `/api/bff/*`, which proxies to this API. Paths below are Express paths (without the `/api/bff` prefix).

**Auth:** Unless noted, endpoints require a valid access-token cookie (session from login/register/refresh). Clients should send cookies (`credentials: "include"`).

**Not documented here:** environment secrets, rate-limit internals, or intentional outage drills.

---

## Mounting

| Prefix | Auth | Module |
|--------|------|--------|
| `/auth` | Mostly public (see table) | `routes/auth.js` |
| `/goals` | Required | `routes/goals.js` |
| `/tasks` | Required | `routes/tasks.js` |
| `/focus` | Required | `routes/focus.js` |
| `/journal` | Required | `routes/journal.js` |
| `/analytics` | Required | `routes/analytics.js` |
| `/activity` | Required | `routes/activity.js` |
| `/agent` | Required | `routes/agent.js` |
| `/integrations` | Required (callback intended public) | `routes/integrations.js` |
| `/health`, `/me`, `/me/password` | See below | `app.js` |

Next.js-only (not Express): `GET /api/config` — client routing flags for BFF vs direct API.

---

## Health & profile

| Method | Path | Auth | Responsibility |
|--------|------|------|----------------|
| `GET` | `/health` | No | Liveness check and coarse feature-flag metadata |
| `GET` | `/me` | Yes | Current user profile |
| `PATCH` | `/me/password` | Yes | Change password while signed in (`currentPassword`, `newPassword`) |

---

## Auth

| Method | Path | Auth | Responsibility |
|--------|------|------|----------------|
| `POST` | `/auth/register` | No | Create account (`email`, `password`, `name`); may send verification email |
| `POST` | `/auth/login` | No | Sign in; establish session cookies |
| `POST` | `/auth/refresh` | Refresh cookie | Rotate refresh session and issue a new access cookie |
| `POST` | `/auth/logout` | No | Revoke refresh token (if present) and clear cookies |
| `GET` | `/auth/ping` | No | Auth router smoke check |
| `POST` | `/auth/forgot-password` | No | Start password reset (`email`); response stays generic |
| `POST` | `/auth/reset-password` | No | Complete reset (`token`, `newPassword`) |
| `POST` | `/auth/verify-email` | No | Verify email (`token`) |
| `POST` | `/auth/resend-verification-email` | Yes | Resend verification email for the signed-in user |

---

## Goals

All require auth. Goals are unit-scoped plans (e.g. lessons) with deadlines and optional weekday / daily-cap constraints.

| Method | Path | Responsibility |
|--------|------|----------------|
| `POST` | `/goals` | Create a goal |
| `GET` | `/goals` | List goals (with related tasks) |
| `PUT` | `/goals/:id` | Update goal fields |
| `DELETE` | `/goals/:id` | Delete goal and its tasks |
| `DELETE` | `/goals/:id/tasks` | Clear all tasks for a goal |
| `GET` | `/goals/:id/evaluation` | Progress evaluation |
| `GET` | `/goals/:id/failure-analysis` | Schedule failure-mode analysis |
| `GET` | `/goals/:id/rebalance-recommendation` | Rebalance recommendation preview |
| `GET` | `/goals/:id/agent-preview` | Combined goal-agent preview (eval + rebalance) |
| `GET` | `/goals/:id/agent-history` | Recent `AgentRun` history for the goal |
| `POST` | `/goals/:id/apply-agent-rebalance` | Apply agent rebalance to task due dates |
| `POST` | `/goals/:id/plan/preview` | Preview auto-plan (read-only) |
| `POST` | `/goals/:id/plan/confirm` | Persist planned tasks |
| `POST` | `/goals/:id/plan/rebalance-preview` | Behind-schedule recovery options (read-only) |
| `POST` | `/goals/:id/plan/rebalance-confirm` | Apply a recovery strategy |
| `POST` | `/goals/:id/plan/refresh` | Alias of rebalance-preview |

**Typical create body:** `title`, `totalUnits`, `unitName`, `deadline`; optional `availableDays` (`MON`…`SUN`), `maxUnitsPerDay`.

**Rebalance-confirm strategies:** `keep_deadline` \| `spread_evenly` \| `increase_daily_load` \| `extend_deadline`.

---

## Tasks

All require auth.

| Method | Path | Responsibility |
|--------|------|----------------|
| `POST` | `/tasks` | Create a task |
| `GET` | `/tasks` | List / filter tasks |
| `PATCH` | `/tasks/:id` | Update task fields |
| `PATCH` | `/tasks/:id/status` | Update status only (`todo` \| `doing` \| `done`) |
| `DELETE` | `/tasks/:id` | Delete owned task |

**Create / update (common):** `title`; optional `goalId`, `dueDate`, `startTime`, `endTime`, `estimatedMin`, `priority` (`low` \| `medium` \| `high` \| `urgent`), `status`.

**List query:** `status`, `goalId`, `startDate`, `endDate`, `includeOverdue`, `tzOffsetMinutes`.

---

## Focus

All require auth.

| Method | Path | Responsibility |
|--------|------|----------------|
| `POST` | `/focus` | Save a completed focus session (`duration`, `startedAt`, `endedAt`; optional `label`) |
| `GET` | `/focus` | List recent sessions (`limit`, default 50, max 200) |
| `GET` | `/focus/summary` | Today’s focus minutes + streak (`tzOffsetMinutes`; optional `date`) |
| `GET` | `/focus/stats` | Aggregate sessions + streak |

---

## Journal

All require auth.

| Method | Path | Responsibility |
|--------|------|----------------|
| `GET` | `/journal/notes` | List notes (newest first) |
| `GET` | `/journal/notes/:id` | Get one note |
| `POST` | `/journal/notes` | Create note (optional `title`, `content`, `font_style`) |
| `PATCH` | `/journal/notes/:id` | Update note |
| `DELETE` | `/journal/notes/:id` | Delete note |

`font_style`: `playful` \| `balanced` \| `professional`.

---

## Analytics

All require auth.

| Method | Path | Responsibility |
|--------|------|----------------|
| `GET` | `/analytics/overview` | Task counts, upcoming work, momentum |
| `GET` | `/analytics/productivity` | Done-tasks-per-day series (`days`, default 14, max 60) |
| `GET` | `/analytics/activity-patterns` | Habit / pattern analysis (`days`, 7–366, default 90) |
| `GET` | `/analytics/dashboard` | Dashboard metrics + trends (`interval`: `day` \| `week` \| `month`, `tzOffsetMinutes`) |

---

## Activity

| Method | Path | Auth | Responsibility |
|--------|------|------|----------------|
| `POST` | `/activity/ping` | Yes | Record a daily visit and update streak (`tzOffsetMinutes`) |

---

## Agent

All require auth. These power Oti (chat, suggestions, outcome learning). Goal planning tools also call into goal domain logic on the server.

| Method | Path | Responsibility |
|--------|------|----------------|
| `POST` | `/agent/chat` | Conversational agent turn (`message` required; optional `tzOffsetMinutes`, `history`, `pendingConfirmation`) |
| `GET` | `/agent/suggestions` | Proactive suggestions (`limit`, `tzOffsetMinutes`) |
| `POST` | `/agent/outcomes/evaluate` | Evaluate outcomes of accepted agent runs (optional `lookbackDays`) |

Chat may invoke validated tools (tasks, goals, memory, calendar/gmail/notion, etc.). Mutating and external write tools generally preview first and require explicit user confirmation before applying.

---

## Integrations

| Method | Path | Auth | Responsibility |
|--------|------|------|----------------|
| `GET` | `/integrations/composio/status` | Yes | Connection status for Calendar / Gmail / Notion |
| `POST` | `/integrations/composio/connect` | Yes | Start OAuth for a toolkit (`toolkit`: `googlecalendar` \| `gmail` \| `notion`) |
| `POST` | `/integrations/composio/disconnect` | Yes | Disconnect a toolkit |
| `GET` | `/integrations/composio/callback` | Intended public | OAuth callback; redirects back to client settings |

There is no separate `/settings` Express API; the settings UI uses `/me`, password change, and these integration endpoints.

---

## Client access patterns

| Mode | How the browser reaches Express |
|------|----------------------------------|
| **Local** | Direct API URL (e.g. `http://localhost:4000`) |
| **Production (split hosts)** | Prefer `/api/bff/...` so cookies stay first-party on the Next host |
| **Hybrid** | Some routes may use a direct API host when configured via `/api/config` |

---

## Related docs

- [Architecture](./architecture.md)
- Root [README.md](../README.md)
