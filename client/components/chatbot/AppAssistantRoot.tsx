"use client";

import type { ReactNode } from "react";
import { ChatbotProvider } from "./ChatbotContext";
import { FocusFlowAssistant } from "./FocusFlowAssistant";

/**
 * Wrap app content once in the root layout. Provides chat context + floating assistant.
 */
export function AppAssistantRoot({ children }: { children: ReactNode }) {
  return (
    <ChatbotProvider>
      {children}
      <FocusFlowAssistant />
    </ChatbotProvider>
  );
}
