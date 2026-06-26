"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useFocusTimer } from "@/context/FocusTimerContext";
import { handleAgentClientActions } from "@/lib/agentClientActions";
import { emitAgentMutation, onOpenAgentChat } from "@/lib/agentEvents";
import { renderChatMessage } from "@/lib/renderChatMessage";
import type { AgentMutationDetail } from "@/lib/agentEvents";

function emitMutationsFromAgentResponse(res: {
  mutations?: string[];
  toolResults?: Array<{
    ok?: boolean;
    tool?: string;
    result?: { data?: { deletedTaskId?: string; createdCount?: number; applied?: boolean } };
  }>;
}) {
  const types = new Set<AgentMutationDetail["type"]>();

  if (Array.isArray(res.mutations)) {
    for (const type of res.mutations) {
      if (type) types.add(type as AgentMutationDetail["type"]);
    }
  }

  if (res.toolResults && Array.isArray(res.toolResults)) {
    for (const tr of res.toolResults) {
      if (!tr.ok) continue;
      if (tr.tool === "create_task") types.add("task_created");
      if (tr.tool === "update_task") types.add("task_updated");
      if (tr.tool === "complete_task") types.add("task_completed");
      if (tr.tool === "delete_task" && tr.result?.data?.deletedTaskId) {
        types.add("task_deleted");
      }
      if (tr.tool === "create_goal") types.add("goal_created");
      if (tr.tool === "confirm_goal_plan" && tr.result?.data?.createdCount) {
        types.add("goal_plan_confirmed");
        types.add("task_created");
      }
      if (tr.tool === "apply_goal_rebalance" && tr.result?.data?.applied) {
        types.add("goal_rebalanced");
        types.add("task_updated");
      }
      if (tr.tool === "apply_goal_adjustment" && tr.result?.data?.applied) {
        types.add("goal_rebalanced");
        types.add("task_updated");
      }
    }
  }

  for (const type of types) {
    emitAgentMutation({ type });
  }
}

const PUBLIC_ROUTES = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);

export default function AgentChat() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    type: string;
    goalId?: string;
    taskId?: string;
    goalTitle?: string;
    taskTitle?: string;
    itemCount?: number;
    changeCount?: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const focusTimer = useFocusTimer();
  const focusTimerActive = focusTimer.isActive;

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      const userMsg = text.trim();
      setInput("");
      setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
      setLoading(true);

      try {
        const history = [...messages, { role: "user" as const, text: userMsg }]
          .slice(-20)
          .map((m) => ({ role: m.role, text: m.text }));
        const res = await api("/agent/chat", {
          method: "POST",
          body: JSON.stringify({
            message: userMsg,
            tzOffsetMinutes: new Date().getTimezoneOffset(),
            history,
            pendingConfirmation,
          }),
        });

        const assistantText =
          res.assistantMessage || "Sorry, I didn't get a response.";
        setMessages((prev) => [...prev, { role: "assistant", text: assistantText }]);
        setPendingConfirmation(res.pendingConfirmation ?? null);

        emitMutationsFromAgentResponse(res);

        if (res.clientActions && Array.isArray(res.clientActions)) {
          const outcomes = handleAgentClientActions(res.clientActions, focusTimer);
          for (const o of outcomes) {
            if (!o.executed && o.reason === "already_active") {
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  text: "A focus session is already running. Stop it first if you want to start a new one.",
                },
              ]);
            }
          }
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Something went wrong.";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: `Error: ${msg}` },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, focusTimer, messages, pendingConfirmation]
  );

  useEffect(() => {
    return onOpenAgentChat((message) => {
      setOpen(true);
      setTimeout(() => {
        void sendMessage(message);
        inputRef.current?.focus();
      }, 100);
    });
  }, [sendMessage]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [open, messages, loading]);

  if (PUBLIC_ROUTES.has(pathname)) return null;

  const openChat = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  return (
    <>
      {/* Fixed pill — bottom-right; shifts up when focus timer is visible */}
      {!open && (
        <button
          type="button"
          onClick={openChat}
          className={`fixed z-40 inline-flex items-center gap-2 rounded-full border border-black/10 bg-black px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground dark:border-white/20 dark:bg-white dark:text-[#0b0c0f] dark:hover:bg-white/90 dark:shadow-[0_4px_20px_rgba(255,255,255,0.08)] right-4 sm:right-6 ${
            focusTimerActive ? "bottom-20 sm:bottom-[5.5rem]" : "bottom-5 sm:bottom-6"
          }`}
          aria-label="Ask Oti"
        >
          <Sparkles size={16} className="shrink-0 text-white/70 dark:text-[#0b0c0f]/60" aria-hidden />
          <span>Ask Oti</span>
        </button>
      )}

      {/* Right-docked chat panel */}
      {open && (
        <aside
          className="fixed right-0 top-[92px] z-40 flex h-[calc(100dvh-92px)] w-full max-w-[min(100vw,24rem)] flex-col border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-200 md:top-[73px] md:h-[calc(100dvh-73px)]"
          role="dialog"
          aria-label="Oti chat"
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-base font-semibold text-foreground">Oti</p>
              <p className="text-xs text-muted-foreground">FocusFlow Agent</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-2 text-muted-foreground transition hover:bg-card-muted hover:text-foreground"
              aria-label="Close chat"
            >
              <X size={18} />
            </button>
          </div>

          {/* Intro + messages */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {messages.length === 0 && (
              <div className="shrink-0 border-b border-border bg-gradient-to-br from-card-muted via-card to-card px-4 py-5">
                <p className="text-sm leading-relaxed text-foreground">
                  I can help you plan tasks, run focus sessions, and stay on track
                  with your goals.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Try: &quot;Start a 25 minute focus session&quot;
                </p>
              </div>
            )}

            <div className="flex-1 space-y-3 px-4 py-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2.5 text-sm ${
                    m.role === "user"
                      ? "ml-auto bg-black text-white dark:bg-white dark:text-[#0b0c0f]"
                      : "mr-auto bg-card-muted text-foreground"
                  }`}
                >
                  {m.role === "assistant" ? renderChatMessage(m.text) : m.text}
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" />
                  Thinking...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
            className="shrink-0 border-t border-border bg-card px-4 py-3"
          >
            <div className="flex items-center gap-2 rounded-xl border border-border bg-input px-3 py-2 shadow-sm focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-foreground/10">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Oti a question"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="shrink-0 rounded-lg p-1.5 text-foreground transition hover:bg-card-muted disabled:opacity-30"
                aria-label="Send"
              >
                <Send size={16} />
              </button>
            </div>
          </form>
        </aside>
      )}
    </>
  );
}
