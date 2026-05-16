"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { isFocusSessionInProgress } from "@/lib/focusTimerStorage";
import {
  formatSecondsRemaining,
  isPublicAuthRoute,
  SESSION_WARN_AT_MS,
  SESSION_WARN_MS,
} from "@/lib/sessionInactivity";

const ACTIVITY_EVENTS = [
  "mousedown",
  "mousemove",
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
  const logoutAtRef = useRef<number | null>(null);
  const scheduleIdleTimersRef = useRef<() => void>(() => {});
  const startWarningPhaseRef = useRef<() => void>(() => {});
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

  const scheduleIdleTimers = useCallback(() => {
    clearTimers();
    setShowWarning(false);

    if (isPublic || isFocusSessionInProgress()) return;

    warnTimerRef.current = setTimeout(() => {
      startWarningPhaseRef.current();
    }, SESSION_WARN_AT_MS);
  }, [clearTimers, isPublic]);

  const startWarningPhase = useCallback(() => {
    if (isFocusSessionInProgress()) {
      scheduleIdleTimersRef.current();
      return;
    }

    const logoutAt = Date.now() + SESSION_WARN_MS;
    logoutAtRef.current = logoutAt;
    setShowWarning(true);
    setSecondsLeft(Math.ceil(SESSION_WARN_MS / 1000));

    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      if (isFocusSessionInProgress()) {
        setShowWarning(false);
        clearTimers();
        scheduleIdleTimersRef.current();
        return;
      }
      const at = logoutAtRef.current;
      if (at == null) return;
      const remaining = Math.max(0, Math.ceil((at - Date.now()) / 1000));
      setSecondsLeft(remaining);
    }, 1000);

    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    logoutTimerRef.current = setTimeout(() => {
      void performLogout();
    }, SESSION_WARN_MS);
  }, [clearTimers, performLogout]);

  scheduleIdleTimersRef.current = scheduleIdleTimers;
  startWarningPhaseRef.current = startWarningPhase;

  const onUserActivity = useCallback(() => {
    if (isPublic) return;
    if (isFocusSessionInProgress()) {
      scheduleIdleTimers();
      return;
    }
    if (showWarningRef.current) {
      lastThrottleRef.current = Date.now();
      scheduleIdleTimers();
      return;
    }

    const now = Date.now();
    if (now - lastThrottleRef.current < ACTIVITY_THROTTLE_MS) return;
    lastThrottleRef.current = now;

    scheduleIdleTimers();
  }, [isPublic, scheduleIdleTimers]);

  const staySignedIn = useCallback(() => {
    lastThrottleRef.current = Date.now();
    scheduleIdleTimers();
  }, [scheduleIdleTimers]);

  useEffect(() => {
    if (isPublic) {
      clearTimers();
      setShowWarning(false);
      return;
    }

    scheduleIdleTimers();

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onUserActivity, { passive: true });
    }

    const focusPoll = setInterval(() => {
      if (isFocusSessionInProgress()) {
        scheduleIdleTimers();
      }
    }, 15_000);

    return () => {
      clearTimers();
      clearInterval(focusPoll);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onUserActivity);
      }
    };
  }, [isPublic, pathname, clearTimers, scheduleIdleTimers, onUserActivity]);

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
