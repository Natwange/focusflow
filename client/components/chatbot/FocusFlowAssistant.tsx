"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, Send, X } from "lucide-react";
import { tryRuleBasedAnalyticsReply } from "@/lib/chatbot";
import {
  ASSISTANT_SHELL_REPLY,
  ASSISTANT_WELCOME,
  SUGGESTED_PROMPTS,
} from "./constants";
import { useChatbotAppContext } from "./ChatbotContext";
import type { ChatMessage } from "./types";

const LAUNCHER_Z = 90;

function makeId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function FocusFlowAssistant() {
  const pathname = usePathname();
  const chatbot = useChatbotAppContext();
  const appContextRef = useRef(chatbot?.appContext);
  appContextRef.current = chatbot?.appContext;

  const panelId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hideOnAuth =
    pathname === "/login" || pathname === "/signup" || pathname === "/register";

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: makeId(),
      role: "assistant",
      content: ASSISTANT_WELCOME,
      createdAt: Date.now(),
    },
  ]);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (open) scrollToBottom();
  }, [open, messages, scrollToBottom]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 200);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sendText = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return;

    const userMsg: ChatMessage = {
      id: makeId(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    window.setTimeout(() => {
      const ctx = appContextRef.current;
      const analyticsReply = tryRuleBasedAnalyticsReply(text, {
        interval: ctx?.analyticsInterval,
        slice: ctx?.analyticsSlice ?? undefined,
      });
      const content = analyticsReply ?? ASSISTANT_SHELL_REPLY;

      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "assistant",
          content,
          createdAt: Date.now(),
        },
      ]);
    }, 450);
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendText(input);
  };

  if (hideOnAuth) return null;

  return (
    <>
      {/* Soft backdrop — light, dismissible */}
      {open ? (
        <button
          type="button"
          aria-label="Close assistant"
          className="fixed inset-0 z-[70] bg-black/[0.06] backdrop-blur-[2px] transition-opacity"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div
        className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 flex flex-col items-end gap-3 pointer-events-none"
        style={{ zIndex: LAUNCHER_Z }}
      >
        {open ? (
          <div
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="FocusFlow assistant"
            className="pointer-events-auto w-[min(100vw-2rem,400px)] h-[min(70vh,520px)] flex flex-col rounded-2xl border border-gray-200/90 bg-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.12)] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          >
            <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-gradient-to-br from-[#F8F9FB] to-white">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  Assistant
                </p>
                <p className="text-[11px] text-gray-500 truncate">
                  Mock analytics answers · swap for AI later
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 w-9 h-9 rounded-xl border border-gray-200/80 bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-50 flex items-center justify-center transition"
                aria-label="Close assistant panel"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </header>

            <div
              ref={listRef}
              className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 bg-[#FAFAFA]/80"
            >
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-[#8FABD4]/25 text-gray-900 border border-[#8FABD4]/20"
                        : "bg-white text-gray-700 border border-gray-200/90 shadow-sm"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
            </div>

            <div className="shrink-0 px-4 pt-2 pb-1 border-t border-gray-100 bg-white">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">
                Suggestions
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => {
                      setInput(prompt);
                      inputRef.current?.focus();
                    }}
                    className="text-left text-xs text-gray-600 bg-[#F5F6F8] hover:bg-[#EEF0F4] border border-gray-200/80 rounded-full px-3 py-1.5 max-w-full transition"
                  >
                    <span className="line-clamp-2">{prompt}</span>
                  </button>
                ))}
              </div>
            </div>

            <form
              onSubmit={onSubmit}
              className="shrink-0 flex gap-2 p-3 border-t border-gray-100 bg-white"
            >
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything…"
                className="flex-1 min-w-0 rounded-xl border border-gray-200 bg-[#FAFAFA] px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#8FABD4]/35 focus:border-[#8FABD4]/40"
                autoComplete="off"
                aria-label="Message"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="shrink-0 w-11 h-11 rounded-xl bg-[#8FABD4]/90 hover:bg-[#7FA0CC] disabled:opacity-40 disabled:pointer-events-none text-white flex items-center justify-center transition"
                aria-label="Send message"
              >
                <Send size={18} strokeWidth={1.75} />
              </button>
            </form>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="pointer-events-auto w-14 h-14 rounded-full border border-gray-200/90 bg-white text-[#5A7AA6] shadow-[0_8px_30px_-8px_rgba(0,0,0,0.15)] hover:shadow-[0_12px_36px_-8px_rgba(0,0,0,0.18)] hover:bg-[#FAFBFC] flex items-center justify-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8FABD4]/50 focus-visible:ring-offset-2"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={open ? "Close assistant" : "Open assistant"}
        >
          {open ? (
            <X size={22} strokeWidth={1.75} className="text-gray-600" />
          ) : (
            <MessageCircle size={24} strokeWidth={1.75} />
          )}
        </button>
      </div>
    </>
  );
}
