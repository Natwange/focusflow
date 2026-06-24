"use client";

import { useEffect } from "react";
import {
  ensureApiRoutingConfig,
  getAppApiBase,
  getDirectApiBase,
  isHybridAuthRoutingEnabled,
  logHybridExperiment,
} from "@/lib/apiConfig";

const HIDDEN_BEFORE_WAKE_MS = 60_000;
const WAKE_PING_TIMEOUT_MS = 8_000;

/**
 * After the tab was backgrounded a while, ping /health so a cold Render API
 * can start waking before the user clicks something that needs data.
 */
export function ApiTabWake() {
  useEffect(() => {
    let cancelled = false;
    let hiddenAt: number | null = null;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt == null) return;
      const hiddenMs = Date.now() - hiddenAt;
      hiddenAt = null;
      if (hiddenMs < HIDDEN_BEFORE_WAKE_MS) return;

      const wakeBase = isHybridAuthRoutingEnabled()
        ? getDirectApiBase()
        : getAppApiBase() || null;
      if (!wakeBase) return;

      const url = `${wakeBase}/health`;
      const signal =
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(WAKE_PING_TIMEOUT_MS)
          : undefined;

      void fetch(url, { credentials: "include", signal })
        .then((res) => {
          logHybridExperiment("health_check", {
            status: res.status,
            url,
            source: "tab_wake",
          });
        })
        .catch(() => {
          /* best-effort warm-up */
        });
    };

    void ensureApiRoutingConfig().then(() => {
      if (cancelled) return;
      document.addEventListener("visibilitychange", onVisibility);
    });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
