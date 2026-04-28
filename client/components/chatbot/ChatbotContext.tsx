"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChatbotAppContext } from "./types";

type ChatbotContextValue = {
  appContext: ChatbotAppContext;
  /** Merge fields into app context (e.g. analytics snapshot from a page). */
  setAppContext: (patch: Partial<ChatbotAppContext>) => void;
};

const ChatbotContext = createContext<ChatbotContextValue | null>(null);

export function ChatbotProvider({ children }: { children: ReactNode }) {
  const [appContext, setAppContextState] = useState<ChatbotAppContext>({});

  const setAppContext = useCallback((patch: Partial<ChatbotAppContext>) => {
    setAppContextState((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo(
    () => ({ appContext, setAppContext }),
    [appContext, setAppContext]
  );

  return (
    <ChatbotContext.Provider value={value}>{children}</ChatbotContext.Provider>
  );
}

export function useChatbotAppContext(): ChatbotContextValue | null {
  return useContext(ChatbotContext);
}
