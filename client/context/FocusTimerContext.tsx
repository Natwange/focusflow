"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import {
  readFocusTimerFromStorage,
  writeFocusTimerToStorage,
  clearFocusTimerStorage,
  type FocusTimerPersisted,
  type FocusMode,
  type RestoredFocusTimer,
} from "@/lib/focusTimerStorage";

export type { FocusMode } from "@/lib/focusTimerStorage";

const MODE_LABELS: Record<FocusMode, string> = {
  focus: "Focus",
  short: "Short Break",
  long: "Long Break",
};

export type StartSessionOpts = {
  durationMinutes: number;
  mode?: FocusMode;
  label?: string | null;
};

export type StartResult =
  | { started: true }
  | { started: false; reason: "already_active" };

export type FocusTimerState = {
  mode: FocusMode;
  totalDuration: number;
  timeLeft: number;
  running: boolean;
  sessionStart: Date | null;
  isActive: boolean;
  isPaused: boolean;
  isIdle: boolean;
};

export type FocusTimerActions = {
  startSession: (opts: StartSessionOpts) => StartResult;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => void;
  switchMode: (mode: FocusMode) => void;
  setDuration: (minutes: number) => void;
};

export type FocusTimerContextValue = FocusTimerState & FocusTimerActions;

const FocusTimerCtx = createContext<FocusTimerContextValue | null>(null);

export function useFocusTimer(): FocusTimerContextValue {
  const ctx = useContext(FocusTimerCtx);
  if (!ctx) {
    throw new Error("useFocusTimer must be used within FocusTimerProvider");
  }
  return ctx;
}

function remainingSecondsFromEnd(endMs: number): number {
  return Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
}

function buildPersisted(args: {
  mode: FocusMode;
  totalDuration: number;
  timeLeft: number;
  running: boolean;
  endWallTimeMs: number | null;
  sessionStart: Date | null;
}): FocusTimerPersisted {
  return {
    v: 1,
    mode: args.mode,
    totalDuration: args.totalDuration,
    timeLeft: args.timeLeft,
    running: args.running,
    endWallTimeMs: args.endWallTimeMs,
    sessionStartIso: args.sessionStart?.toISOString() ?? null,
  };
}

const DEFAULT_DURATIONS: Record<FocusMode, number> = {
  focus: 25 * 60,
  short: 5 * 60,
  long: 15 * 60,
};

export function FocusTimerProvider({ children }: { children: ReactNode }) {
  const [initialRestore] = useState<RestoredFocusTimer | null>(() =>
    readFocusTimerFromStorage()
  );

  const [mode, setMode] = useState<FocusMode>(() => initialRestore?.mode ?? "focus");
  const [totalDuration, setTotalDuration] = useState(
    () => initialRestore?.totalDuration ?? DEFAULT_DURATIONS.focus
  );
  const [timeLeft, setTimeLeft] = useState(
    () => initialRestore?.timeLeft ?? DEFAULT_DURATIONS.focus
  );
  const [running, setRunning] = useState(() => initialRestore?.running ?? false);
  const [sessionStart, setSessionStart] = useState<Date | null>(
    () => initialRestore?.sessionStart ?? null
  );
  const [expiredWhileAway, setExpiredWhileAway] = useState(
    () => initialRestore?.expiredWhileAway ?? false
  );

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeRef = useRef<number | null>(initialRestore?.endWallTimeMs ?? null);
  const totalDurationRef = useRef(totalDuration);
  const workerRef = useRef<Worker | null>(null);
  const pendingSound = useRef(false);
  const completionLockRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlocked = useRef(false);
  const labelRef = useRef<string | null>(null);

  totalDurationRef.current = totalDuration;

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio("/sounds/bell.mp3");
      audioRef.current.volume = 0.7;
    }
    if (!audioUnlocked.current) {
      audioRef.current
        .play()
        .then(() => {
          audioRef.current!.pause();
          audioRef.current!.currentTime = 0;
          audioUnlocked.current = true;
        })
        .catch(() => {});
    }
  }, []);

  const playSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, []);

  const saveSession = useCallback(
    async (start: Date, durationSec: number, sessionMode: FocusMode) => {
      const end = new Date();
      const durationMin = Math.max(1, Math.round(durationSec / 60));
      try {
        await api("/focus", {
          method: "POST",
          body: JSON.stringify({
            label: labelRef.current ?? MODE_LABELS[sessionMode],
            duration: durationMin,
            startedAt: start.toISOString(),
            endedAt: end.toISOString(),
          }),
        });
      } catch {
        /* silent */
      }
    },
    []
  );

  const persist = useCallback(() => {
    const idleNoSession =
      !running && sessionStart === null && (timeLeft === totalDuration || timeLeft === 0);
    if (idleNoSession && timeLeft !== 0) {
      clearFocusTimerStorage();
      return;
    }
    if (timeLeft === 0 && !running && !sessionStart) {
      clearFocusTimerStorage();
      return;
    }
    writeFocusTimerToStorage(
      buildPersisted({
        mode,
        totalDuration,
        timeLeft,
        running,
        endWallTimeMs: endTimeRef.current,
        sessionStart,
      })
    );
  }, [mode, totalDuration, timeLeft, running, sessionStart]);

  useEffect(() => {
    persist();
  }, [persist]);

  const completeTimer = useCallback(() => {
    if (completionLockRef.current) return;
    if (endTimeRef.current === null && !pendingSound.current) return;

    completionLockRef.current = true;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    workerRef.current?.postMessage({ type: "stop" });

    const start = sessionStart;
    const currentMode = mode;
    const planned = totalDurationRef.current;

    endTimeRef.current = null;
    setTimeLeft(0);
    setRunning(false);
    setSessionStart(null);
    pendingSound.current = false;

    playSound();

    if (start && currentMode === "focus") {
      const elapsedSec = Math.min(
        planned,
        Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000))
      );
      if (elapsedSec >= 60) {
        saveSession(start, elapsedSec, currentMode);
      }
    }

    clearFocusTimerStorage();
    labelRef.current = null;
    completionLockRef.current = false;
  }, [playSound, sessionStart, mode, saveSession]);

  // Expired while away
  useEffect(() => {
    if (!expiredWhileAway) return;
    setExpiredWhileAway(false);
    ensureAudio();
    playSound();
    const start = sessionStart;
    if (start && mode === "focus") {
      const planned = totalDurationRef.current;
      const elapsedSec = Math.min(
        planned,
        Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000))
      );
      if (elapsedSec >= 60) {
        saveSession(start, elapsedSec, mode);
      }
    }
    setSessionStart(null);
    clearFocusTimerStorage();
    labelRef.current = null;
  }, [expiredWhileAway, sessionStart, mode, ensureAudio, playSound, saveSession]);

  // Web Worker
  useEffect(() => {
    const code = `
      let tid = null;
      self.onmessage = function(e) {
        if (tid) { clearTimeout(tid); tid = null; }
        if (e.data && e.data.type === "start" && e.data.ms > 0) {
          tid = setTimeout(function() { self.postMessage("done"); }, e.data.ms);
        }
      };
    `;
    const blob = new Blob([code], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    workerRef.current = new Worker(url);
    URL.revokeObjectURL(url);

    const r = initialRestore;
    if (r?.running && r.endWallTimeMs != null) {
      const ms = Math.max(0, r.endWallTimeMs - Date.now());
      if (ms > 0) {
        workerRef.current.postMessage({ type: "start", ms });
      }
    }

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Worker "done"
  useEffect(() => {
    const w = workerRef.current;
    if (!w) return;
    const handler = (e: MessageEvent) => {
      if (e.data !== "done") return;
      if (endTimeRef.current === null) return;
      if (document.visibilityState === "visible") {
        completeTimer();
      } else {
        pendingSound.current = true;
      }
    };
    w.addEventListener("message", handler);
    return () => w.removeEventListener("message", handler);
  }, [completeTimer]);

  // Tab visibility
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (pendingSound.current) {
        completeTimer();
        return;
      }
      if (endTimeRef.current !== null) {
        const remaining = remainingSecondsFromEnd(endTimeRef.current);
        if (remaining <= 0) {
          completeTimer();
        } else {
          setTimeLeft(remaining);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [completeTimer]);

  // Display loop
  useEffect(() => {
    if (!running || endTimeRef.current === null) return;
    const tick = () => {
      const end = endTimeRef.current;
      if (end === null) return;
      const remaining = remainingSecondsFromEnd(end);
      if (remaining <= 0) {
        completeTimer();
      } else {
        setTimeLeft(remaining);
      }
    };
    tick();
    intervalRef.current = setInterval(tick, 250);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, completeTimer]);

  // --- Actions ---

  const startSession = useCallback(
    (opts: StartSessionOpts): StartResult => {
      if (running || sessionStart !== null) {
        return { started: false, reason: "already_active" };
      }

      const requestedMode = opts.mode ?? "focus";
      const raw = Number(opts.durationMinutes);
      const minutes = Number.isFinite(raw) && raw >= 1 && raw <= 180 ? Math.round(raw) : 25;
      const durationSec = minutes * 60;

      labelRef.current = opts.label ?? null;
      setMode(requestedMode);
      setTotalDuration(durationSec);
      setTimeLeft(durationSec);

      ensureAudio();
      const end = Date.now() + durationSec * 1000;
      endTimeRef.current = end;
      pendingSound.current = false;
      workerRef.current?.postMessage({ type: "start", ms: durationSec * 1000 });
      setSessionStart(new Date());
      setRunning(true);

      return { started: true };
    },
    [running, sessionStart, ensureAudio]
  );

  const pause = useCallback(() => {
    if (!running) return;
    setRunning(false);
    const remaining = endTimeRef.current
      ? remainingSecondsFromEnd(endTimeRef.current)
      : timeLeft;
    endTimeRef.current = null;
    pendingSound.current = false;
    workerRef.current?.postMessage({ type: "stop" });
    setTimeLeft(Math.max(0, remaining));
  }, [running, timeLeft]);

  const resume = useCallback(() => {
    if (running || sessionStart === null) return;
    ensureAudio();
    const end = Date.now() + timeLeft * 1000;
    endTimeRef.current = end;
    pendingSound.current = false;
    workerRef.current?.postMessage({ type: "start", ms: timeLeft * 1000 });
    setRunning(true);
  }, [running, sessionStart, timeLeft, ensureAudio]);

  const stop = useCallback(() => {
    if (sessionStart && mode === "focus") {
      const elapsed = totalDuration - timeLeft;
      if (elapsed >= 60) {
        saveSession(sessionStart, elapsed, mode);
      }
    }
    setRunning(false);
    endTimeRef.current = null;
    pendingSound.current = false;
    workerRef.current?.postMessage({ type: "stop" });
    setSessionStart(null);
    setTimeLeft(totalDuration);
    clearFocusTimerStorage();
    labelRef.current = null;
  }, [sessionStart, mode, totalDuration, timeLeft, saveSession]);

  const reset = useCallback(() => {
    setRunning(false);
    endTimeRef.current = null;
    pendingSound.current = false;
    workerRef.current?.postMessage({ type: "stop" });
    setSessionStart(null);
    setTimeLeft(totalDuration);
    clearFocusTimerStorage();
    labelRef.current = null;
  }, [totalDuration]);

  const switchModeAction = useCallback(
    (m: FocusMode) => {
      if (running) return;
      setMode(m);
      const dur = DEFAULT_DURATIONS[m];
      setTotalDuration(dur);
      setTimeLeft(dur);
      setSessionStart(null);
      clearFocusTimerStorage();
      labelRef.current = null;
    },
    [running]
  );

  const setDurationAction = useCallback(
    (minutes: number) => {
      if (running) return;
      const clamped = Math.max(1, Math.min(180, Math.round(minutes)));
      setTotalDuration(clamped * 60);
      setTimeLeft(clamped * 60);
    },
    [running]
  );

  const isActive = running || sessionStart !== null;
  const isPaused = !running && sessionStart !== null;
  const isIdle = !running && sessionStart === null && timeLeft === totalDuration;

  const value: FocusTimerContextValue = {
    mode,
    totalDuration,
    timeLeft,
    running,
    sessionStart,
    isActive,
    isPaused,
    isIdle,
    startSession,
    pause,
    resume,
    stop,
    reset,
    switchMode: switchModeAction,
    setDuration: setDurationAction,
  };

  return <FocusTimerCtx.Provider value={value}>{children}</FocusTimerCtx.Provider>;
}
