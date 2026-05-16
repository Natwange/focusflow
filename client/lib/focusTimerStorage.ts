/**
 * Persists in-progress focus timer state across route changes (sessionStorage).
 * Cleared when session is idle, reset, stopped, or completed.
 */

export type FocusMode = "focus" | "short" | "long";

const KEY = "focusflow_timer_v1";

export type FocusTimerPersisted = {
  v: 1;
  mode: FocusMode;
  totalDuration: number;
  timeLeft: number;
  running: boolean;
  /** Wall-clock ms when countdown reaches zero (only while running) */
  endWallTimeMs: number | null;
  sessionStartIso: string | null;
};

export type RestoredFocusTimer = {
  mode: FocusMode;
  totalDuration: number;
  timeLeft: number;
  running: boolean;
  endWallTimeMs: number | null;
  sessionStart: Date | null;
  /** Timer reached zero while the page was not mounted (e.g. navigated away) */
  expiredWhileAway: boolean;
};

function isBrowser() {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

export function readFocusTimerFromStorage(): RestoredFocusTimer | null {
  if (!isBrowser()) return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as FocusTimerPersisted;
    if (p.v !== 1) return null;

    const sessionStart = p.sessionStartIso ? new Date(p.sessionStartIso) : null;

    if (p.running && p.endWallTimeMs != null) {
      const remainingMs = p.endWallTimeMs - Date.now();
      if (remainingMs <= 0) {
        return {
          mode: p.mode,
          totalDuration: p.totalDuration,
          timeLeft: 0,
          running: false,
          endWallTimeMs: null,
          sessionStart,
          expiredWhileAway: true,
        };
      }
      return {
        mode: p.mode,
        totalDuration: p.totalDuration,
        timeLeft: Math.max(0, Math.ceil(remainingMs / 1000)),
        running: true,
        endWallTimeMs: p.endWallTimeMs,
        sessionStart,
        expiredWhileAway: false,
      };
    }

    return {
      mode: p.mode,
      totalDuration: p.totalDuration,
      timeLeft: p.timeLeft,
      running: false,
      endWallTimeMs: null,
      sessionStart,
      expiredWhileAway: false,
    };
  } catch {
    return null;
  }
}

export function writeFocusTimerToStorage(state: FocusTimerPersisted): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

export function clearFocusTimerStorage(): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** True while a focus session is running or paused (do not idle-logout mid-session). */
export function isFocusSessionInProgress(): boolean {
  const r = readFocusTimerFromStorage();
  return Boolean(r && (r.running || r.sessionStart));
}
