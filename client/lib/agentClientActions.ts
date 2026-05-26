import type { FocusTimerActions, FocusMode, StartResult } from "@/context/FocusTimerContext";

export type AgentClientAction = {
  type: string;
  mode?: string;
  durationMinutes?: number;
  label?: string | null;
  [key: string]: unknown;
};

export type ActionOutcome =
  | { executed: true; type: string }
  | { executed: false; type: string; reason: string };

function isValidFocusMode(v: unknown): v is FocusMode {
  return v === "focus" || v === "short" || v === "long";
}

function handleStartFocusSession(
  action: AgentClientAction,
  focusTimer: FocusTimerActions
): ActionOutcome {
  const raw = Number(action.durationMinutes);
  const durationMinutes = Number.isFinite(raw) && raw >= 1 && raw <= 180 ? Math.round(raw) : 25;
  const mode: FocusMode = isValidFocusMode(action.mode) ? action.mode : "focus";
  const label = typeof action.label === "string" && action.label.trim() ? action.label.trim() : null;

  const result: StartResult = focusTimer.startSession({ durationMinutes, mode, label });

  if (result.started) {
    return { executed: true, type: "start_focus_session" };
  }
  return { executed: false, type: "start_focus_session", reason: result.reason };
}

/**
 * Execute structured clientActions returned from POST /agent/chat.
 */
export function handleAgentClientActions(
  actions: unknown,
  focusTimer: FocusTimerActions
): ActionOutcome[] {
  if (!Array.isArray(actions)) return [];
  const outcomes: ActionOutcome[] = [];

  for (const raw of actions) {
    if (!raw || typeof raw !== "object") continue;
    const action = raw as AgentClientAction;

    switch (action.type) {
      case "start_focus_session":
        outcomes.push(handleStartFocusSession(action, focusTimer));
        break;
      default:
        outcomes.push({ executed: false, type: action.type ?? "unknown", reason: "unsupported_action" });
    }
  }

  return outcomes;
}
