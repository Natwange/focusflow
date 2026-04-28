export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
};

import type { AnalyticsInterval } from "@/lib/productivityScore";
import type { AnalyticsSlice } from "@/lib/analyticsTypes";

/** App-wide hints for the assistant; extend when wiring real backends. */
export type ChatbotAppContext = {
  metadata?: Record<string, unknown>;
  /** Last interval selected on Analytics. */
  analyticsInterval?: AnalyticsInterval;
  /** Latest analytics view model (rule-based chat uses this when present). */
  analyticsSlice?: AnalyticsSlice | null;
};
