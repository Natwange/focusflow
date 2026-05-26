"use client";

import { useState, useRef, useCallback } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useFocusTimer } from "@/context/FocusTimerContext";
import { handleAgentClientActions } from "@/lib/agentClientActions";

export default function AgentChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusTimer = useFocusTimer();

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      const userMsg = text.trim();
      setInput("");
      setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
      setLoading(true);

      try {
        const res = await api("/agent/chat", {
          method: "POST",
          body: JSON.stringify({
            message: userMsg,
            tzOffsetMinutes: new Date().getTimezoneOffset(),
          }),
        });

        const assistantText =
          res.assistantMessage || "Sorry, I didn't get a response.";
        setMessages((prev) => [...prev, { role: "assistant", text: assistantText }]);

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
    [loading, focusTimer]
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 100);
        }}
        className="fixed bottom-16 left-4 z-[9998] rounded-full bg-black p-3 text-white shadow-lg hover:bg-black/90 transition dark:bg-white dark:text-black dark:hover:bg-white/90"
        aria-label="Open agent chat"
      >
        <MessageCircle size={20} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-16 left-4 z-[9998] w-80 max-h-[420px] flex flex-col rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-[#2a303a] dark:bg-[#13161b]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-[#2a303a]">
        <span className="text-sm font-semibold dark:text-[#f5f7fb]">
          FocusFlow Agent
        </span>
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
