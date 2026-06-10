"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, X, Send, Loader2, GripHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { useFocusTimer } from "@/context/FocusTimerContext";
import { handleAgentClientActions } from "@/lib/agentClientActions";
import { emitAgentMutation } from "@/lib/agentEvents";

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
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
  const [position, setPosition] = useState({ x: 16, y: 64 });
  const inputRef = useRef<HTMLInputElement>(null);
  const focusTimer = useFocusTimer();
  const dragging = useRef(false);
  const didDrag = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      didDrag.current = true;
      const x = clamp(e.clientX - dragOffset.current.x, 0, window.innerWidth - 320);
      const y = clamp(e.clientY - dragOffset.current.y, 0, window.innerHeight - 60);
      setPosition({ x, y });
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const onDragStart = (e: React.PointerEvent) => {
    dragging.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - (rect?.left ?? position.x),
      y: e.clientY - (rect?.top ?? position.y),
    };
    e.preventDefault();
  };

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      const userMsg = text.trim();
      setInput("");
      setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
      setLoading(true);

      try {
        const history = messages.slice(-20).map((m) => ({ role: m.role, text: m.text }));
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

        // Emit real-time mutation events for task changes
        if (res.toolResults && Array.isArray(res.toolResults)) {
          for (const tr of res.toolResults) {
            if (!tr.ok) continue;
            if (tr.tool === "create_task") emitAgentMutation({ type: "task_created" });
            if (tr.tool === "update_task") emitAgentMutation({ type: "task_updated" });
            if (tr.tool === "complete_task") emitAgentMutation({ type: "task_completed" });
            if (tr.tool === "delete_task" && tr.result?.data?.deletedTaskId) emitAgentMutation({ type: "task_deleted" });
            if (tr.tool === "create_goal") emitAgentMutation({ type: "goal_created" });
            if (tr.tool === "confirm_goal_plan" && tr.result?.data?.createdCount) {
              emitAgentMutation({ type: "goal_plan_confirmed" });
              emitAgentMutation({ type: "task_created" });
            }
            if (tr.tool === "apply_goal_rebalance" && tr.result?.data?.applied) {
              emitAgentMutation({ type: "goal_rebalanced" });
              emitAgentMutation({ type: "task_updated" });
            }
            if (tr.tool === "apply_goal_adjustment" && tr.result?.data?.applied) {
              emitAgentMutation({ type: "goal_rebalanced" });
              emitAgentMutation({ type: "task_updated" });
            }
          }
        }

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

  if (PUBLIC_ROUTES.has(pathname)) return null;

  const onBubbleDragStart = (e: React.PointerEvent) => {
    dragging.current = true;
    didDrag.current = false;
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onBubbleClick = () => {
    if (didDrag.current) return;
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  if (!open) {
    return (
      <div
        ref={containerRef}
        onPointerDown={onBubbleDragStart}
        onClick={onBubbleClick}
        style={{ left: position.x, top: position.y }}
        className="fixed z-[9998] rounded-full bg-black p-3 text-white shadow-lg hover:bg-black/90 transition cursor-grab active:cursor-grabbing dark:bg-white dark:text-black dark:hover:bg-white/90"
        role="button"
        aria-label="Open agent chat"
      >
        <MessageCircle size={20} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ left: position.x, top: position.y }}
      className="fixed z-[9998] w-80 max-h-[420px] flex flex-col rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-[#2a303a] dark:bg-[#13161b]"
    >
      {/* Header — draggable */}
      <div
        onPointerDown={onDragStart}
        className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-[#2a303a] cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-1.5">
          <GripHorizontal size={14} className="text-gray-400" />
          <span className="text-sm font-semibold dark:text-[#f5f7fb]">
            FocusFlow Agent
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-1 hover:bg-gray-100 dark:hover:bg-[#1c2028]"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-[200px] max-h-[300px]">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-[#6b7280] mt-4 text-center">
            Try: &quot;Start a 25 minute focus session&quot;
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm px-3 py-2 rounded-lg max-w-[90%] whitespace-pre-wrap ${
              m.role === "user"
                ? "ml-auto bg-black text-white dark:bg-white dark:text-black"
                : "mr-auto bg-gray-100 text-black dark:bg-[#1c2028] dark:text-[#f5f7fb]"
            }`}
          >
            {m.text}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Loader2 size={12} className="animate-spin" />
            Thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-[#2a303a]"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent..."
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-400 dark:text-[#f5f7fb] dark:placeholder:text-[#6b7280]"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="rounded-full p-1.5 text-black hover:bg-gray-100 disabled:opacity-30 transition dark:text-[#f5f7fb] dark:hover:bg-[#1c2028]"
          aria-label="Send"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
