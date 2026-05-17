"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { isFocusSessionInProgress } from "@/lib/focusTimerStorage";
import {
  formatSecondsRemaining,
  isPublicAuthRoute,
  SESSION_IDLE_MS,
  SESSION_WARN_AT_MS,
  SESSION_WARN_MS,
} from "@/lib/sessionInactivity";

/** Meaningful interaction only — avoid mousemove, which fires constantly. */
const ACTIVITY_EVENTS = [
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

const ACTIVITY_THROTTLE_MS = 30_000;

export function SessionInactivityMonitor() {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = isPublicAuthRoute(pathname);

  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(SESSION_WARN_MS / 1000);

  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastThrottleRef = useRef(0);
  const lastActivityAtRef = useRef(Date.now());
  const logoutAtRef = useRef<number | null>(null);
  const performLogoutRef = useRef<() => Promise<void>>(async () => {});
  const showWarningRef = useRef(false);
  showWarningRef.current = showWarning;

  const clearTimers = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    warnTimerRef.current = null;
    logoutTimerRef.current = null;
    countdownRef.current = null;
    logoutAtRef.current = null;
  }, []);

  const performLogout = useCallback(async () => {
    clearTimers();
    setShowWarning(false);
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* cookie may already be invalid */
    }
    router.replace("/login?timeout=1");
    router.refresh();
  }, [clearTimers, router]);

  performLogoutRef.current = performLogout;

  const beginWarningCountdown = useCallback(
    (remainingMs: number) => {
      const remaining = Math.max(0, remainingMs);
      if (remaining <= 0) {
        void performLogoutRef.current();
        return;
      }

      const logoutAt = Date.now() + remaining;
      logoutAtRef.current = logoutAt;
      setShowWarning(true);
      setSecondsLeft(Math.ceil(remaining / 1000));

      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        if (isFocusSessionInProgress()) {
          setShowWarning(false);
          clearTimers();
          lastActivityAtRef.current = Date.now();
          return;
        }
        const at = logoutAtRef.current;
        if (at == null) return;
        const left = Math.max(0, Math.ceil((at - Date.now()) / 1000));
        setSecondsLeft(left);
        if (left <= 0) {
          void performLogoutRef.current();
        }
      }, 1000);

      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = setTimeout(() => {
        void performLogoutRef.current();
      }, remaining);
    },
    [clearTimers]
  );

  const reconcileIdleState = useCallback(() => {
    if (isPublic || isFocusSessionInProgress()) {
      clearTimers();
      setShowWarning(false);
      return;
    }

    const idleMs = Date.now() - lastActivityAtRef.current;

    if (idleMs >= SESSION_IDLE_MS) {
      void performLogoutRef.current();
      return;
    }

    if (idleMs >= SESSION_WARN_AT_MS) {
      clearTimers();
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      warnTimerRef.current = null;
      beginWarningCountdown(SESSION_IDLE_MS - idleMs);
      return;
    }

    clearTimers();
    setShowWarning(false);

    const untilWarn = SESSION_WARN_AT_MS - idleMs;
    warnTimerRef.current = setTimeout(() => {
      beginWarningCountdown(SESSION_WARN_MS);
    }, untilWarn);
  }, [isPublic, clearTimers, beginWarningCountdown]);

  const onUserActivity = useCallback(() => {
    if (isPublic) return;

    const now = Date.now();

    if (isFocusSessionInProgress()) {
      lastActivityAtRef.current = now;
      reconcileIdleState();
      return;
    }

    if (showWarningRef.current) {
      lastActivityAtRef.current = now;
      lastThrottleRef.current = now;
      reconcileIdleState();
      return;
    }

    if (now - lastThrottleRef.current < ACTIVITY_THROTTLE_MS) return;
    lastThrottleRef.current = now;
    lastActivityAtRef.current = now;
    reconcileIdleState();
  }, [isPublic, reconcileIdleState]);

  const staySignedIn = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    lastThrottleRef.current = Date.now();
    reconcileIdleState();
  }, [reconcileIdleState]);

  useEffect(() => {
    if (isPublic) {
      clearTimers();
      setShowWarning(false);
      return;
    }

    lastActivityAtRef.current = Date.now();
    reconcileIdleState();

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onUserActivity, { passive: true });
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        reconcileIdleState();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const focusPoll = setInterval(() => {
      if (isFocusSessionInProgress()) {
        lastActivityAtRef.current = Date.now();
        reconcileIdleState();
      }
    }, 15_000);

    return () => {
      clearTimers();
      clearInterval(focusPoll);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onUserActivity);
      }
    };
  }, [isPublic, pathname, clearTimers, reconcileIdleState, onUserActivity]);

  if (!showWarning || isPublic) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        aria-hidden
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-idle-title"
        aria-describedby="session-idle-desc"
        className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white px-6 py-6 shadow-2xl dark:border-neutral-700 dark:bg-neutral-950"
      >
        <h2
          id="session-idle-title"
          className="text-lg font-semibold tracking-tight text-gray-900 dark:text-neutral-100"
        >
          Are you still there?
        </h2>
        <p
          id="session-idle-desc"
          className="mt-2 text-sm text-gray-600 leading-relaxed dark:text-neutral-400"
        >
          You have been inactive for a while. For your security, you will be
          signed out in{" "}
          <span className="font-medium text-gray-900 dark:text-neutral-100">
            {formatSecondsRemaining(secondsLeft)}
          </span>{" "}
          unless you stay signed in.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => void performLogout()}
            className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-900"
          >
            Sign out now
          </button>
          <button
            type="button"
            onClick={staySignedIn}
            className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
