/**
 * Lightweight custom event bus for agent-triggered data changes.
 * Page components subscribe to refresh their data when the agent mutates tasks/focus/etc.
 */

const EVENT_NAME = "focusflow:agent-mutation";

export type AgentMutationDetail = {
  type: "task_created" | "task_updated" | "task_completed" | "task_deleted" | "focus_started";
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
