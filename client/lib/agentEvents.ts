/**
 * Lightweight custom event bus for agent-triggered data changes.
 * Page components subscribe to refresh their data when the agent mutates tasks/focus/etc.
 */

const EVENT_NAME = "focusflow:agent-mutation";

export type AgentMutationDetail = {
  type:
    | "task_created"
    | "task_updated"
    | "task_completed"
    | "task_deleted"
    | "focus_started"
    | "goal_created"
    | "goal_plan_confirmed"
    | "goal_rebalanced";
};

export function emitAgentMutation(detail: AgentMutationDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

export function onAgentMutation(callback: (detail: AgentMutationDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    callback((e as CustomEvent<AgentMutationDetail>).detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

const OPEN_CHAT_EVENT = "focusflow:open-agent-chat";

export function openAgentChatWithMessage(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(OPEN_CHAT_EVENT, { detail: { message } })
  );
}

export function onOpenAgentChat(
  callback: (message: string) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const message = (e as CustomEvent<{ message?: string }>).detail?.message;
    if (message) callback(message);
  };
  window.addEventListener(OPEN_CHAT_EVENT, handler);
  return () => window.removeEventListener(OPEN_CHAT_EVENT, handler);
}

export type AgentSuggestion = {
  id: string;
  type: string;
  severity: "low" | "medium" | "high";
  title: string;
  message: string;
  recommendedAction: string;
  relatedGoalId: string | null;
  relatedGoalTitle: string | null;
  requiresConfirmation: boolean;
  sourceSignals: string[];
};

export function suggestionChatPrompt(suggestion: AgentSuggestion): string {
  const goal = suggestion.relatedGoalTitle;
  switch (suggestion.recommendedAction) {
    case "preview_rebalance":
      return goal
        ? `Help me preview a rebalance for my ${goal} goal`
        : "Help me preview a rebalance for my schedule";
    case "preview_adjustment":
      return goal
        ? `Help me adjust the plan for my ${goal} goal`
        : "Help me adjust my goal plan";
    case "reschedule_tasks":
      return "Help me reschedule my overdue tasks";
    case "extend_deadline":
      return goal
        ? `Help me extend the deadline for my ${goal} goal`
        : "Help me extend my goal deadline";
    case "reduce_scope":
      return goal
        ? `Help me reduce scope on my ${goal} goal`
        : "Help me reduce scope on my goal";
    case "start_focus_session":
      return "Start a 25 minute focus session";
    default:
      return "What should I focus on today?";
  }
}
