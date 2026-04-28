"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import {
  readFocusTimerFromStorage,
  writeFocusTimerToStorage,
  clearFocusTimerStorage,
  type FocusTimerPersisted,
  type FocusMode,
  type RestoredFocusTimer,
} from "@/lib/focusTimerStorage";
import { Pause, RotateCcw, Square, Volume2, VolumeX } from "lucide-react";

type Mode = FocusMode;

const DEFAULT_DURATIONS: Record<Mode, number> = {
  focus: 25 * 60,
  short: 5 * 60,
  long: 15 * 60,
};

const MODE_LABELS: Record<Mode, string> = {
  focus: "Focus",
  short: "Short Break",
  long: "Long Break",
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Seconds remaining from wall-clock end (ceil = friendlier countdown) */
function remainingSecondsFromEnd(endMs: number): number {
  return Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
}

function buildPersisted(args: {
  mode: Mode;
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

export default function FocusPage() {
  /** Snapshot once per mount (avoid reading sessionStorage every render). */
  const [initialRestore] = useState<RestoredFocusTimer | null>(() =>
    readFocusTimerFromStorage()
  );

  const [mode, setMode] = useState<Mode>(() => initialRestore?.mode ?? "focus");
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

  const [totalSessions, setTotalSessions] = useState(0);
  const [streak, setStreak] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingTime, setEditingTime] = useState(false);
  const [editMinutes, setEditMinutes] = useState("");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeRef = useRef<number | null>(initialRestore?.endWallTimeMs ?? null);
  const totalDurationRef = useRef(totalDuration);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlocked = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const pendingSound = useRef(false);
  const completionLockRef = useRef(false);

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

  const fetchStats = useCallback(async () => {
    try {
      const data = await api("/focus/stats");
      setTotalSessions(data.totalSessions ?? 0);
      setStreak(data.streak ?? 0);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const saveSession = useCallback(
    async (start: Date, durationSec: number) => {
      setSaving(true);
      const end = new Date();
      const durationMin = Math.max(1, Math.round(durationSec / 60));
      try {
        await api("/focus", {
          method: "POST",
          body: JSON.stringify({
            label: MODE_LABELS[mode],
            duration: durationMin,
            startedAt: start.toISOString(),
            endedAt: end.toISOString(),
          }),
        });
        fetchStats();
      } catch {
        /* silent */
      } finally {
        setSaving(false);
      }
    },
    [mode, fetchStats]
  );

  const playSound = useCallback(() => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, [soundEnabled]);

  totalDurationRef.current = totalDuration;

  const persist = useCallback(() => {
    const idleNoSession =
      !running &&
      sessionStart === null &&
      (timeLeft === totalDuration || timeLeft === 0);
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
    const wasFocus = mode === "focus";
    const planned = totalDurationRef.current;

    endTimeRef.current = null;
    setTimeLeft(0);
    setRunning(false);
    setSessionStart(null);
    pendingSound.current = false;

    playSound();

    if (start && wasFocus) {
      const elapsedSec = Math.min(
        planned,
        Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000))
      );
      if (elapsedSec >= 60) {
        saveSession(start, elapsedSec);
      }
    }

    clearFocusTimerStorage();
    completionLockRef.current = false;
  }, [playSound, sessionStart, mode, saveSession]);

  // Finish session that expired while user was on another route
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
        saveSession(start, elapsedSec);
      }
    }
    setSessionStart(null);
    clearFocusTimerStorage();
  }, [expiredWhileAway, sessionStart, mode, ensureAudio, playSound, saveSession]);

  // Single Web Worker for background tab; re-arm once from restore snapshot on mount
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
    // initialRestore is fixed at first mount; worker must not be recreated on pause/resume
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Worker "done" — single path when end time still set
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

  // Tab visibility: sync display + drain pending completion
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

  // Display loop — wall clock only (no tick counting)
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

  const handleStart = () => {
    ensureAudio();
    const duration = timeLeft === 0 ? totalDuration : timeLeft;
    if (timeLeft === 0) setTimeLeft(totalDuration);
    const end = Date.now() + duration * 1000;
    endTimeRef.current = end;
    pendingSound.current = false;
    workerRef.current?.postMessage({ type: "start", ms: duration * 1000 });
    setSessionStart(new Date());
    setRunning(true);
  };

  const handlePause = () => {
    setRunning(false);
    const remaining = endTimeRef.current
      ? remainingSecondsFromEnd(endTimeRef.current)
      : timeLeft;
    endTimeRef.current = null;
    pendingSound.current = false;
    workerRef.current?.postMessage({ type: "stop" });
    setTimeLeft(Math.max(0, remaining));
  };

  const handleResume = () => {
    ensureAudio();
    const end = Date.now() + timeLeft * 1000;
    endTimeRef.current = end;
    pendingSound.current = false;
    workerRef.current?.postMessage({ type: "start", ms: timeLeft * 1000 });
    setRunning(true);
  };

  const handleReset = () => {
    setRunning(false);
    endTimeRef.current = null;
    pendingSound.current = false;
    workerRef.current?.postMessage({ type: "stop" });
    setSessionStart(null);
    setTimeLeft(totalDuration);
    clearFocusTimerStorage();
  };

  const handleStop = () => {
    if (sessionStart && mode === "focus") {
      const elapsed = totalDuration - timeLeft;
      if (elapsed >= 60) {
        saveSession(sessionStart, elapsed);
      }
    }
    setRunning(false);
    endTimeRef.current = null;
    pendingSound.current = false;
    workerRef.current?.postMessage({ type: "stop" });
    setSessionStart(null);
    setTimeLeft(totalDuration);
    clearFocusTimerStorage();
  };

  const switchMode = (m: Mode) => {
    if (running) return;
    setMode(m);
    const dur = DEFAULT_DURATIONS[m];
    setTotalDuration(dur);
    setTimeLeft(dur);
    setSessionStart(null);
    clearFocusTimerStorage();
  };

  const isIdle = !running && sessionStart === null && timeLeft === totalDuration;
  const isPaused = !running && sessionStart !== null;
  const isFinished = !running && timeLeft === 0;

  return (
    <div className="h-[calc(100vh-56px)] bg-white text-black flex flex-col items-center justify-between relative overflow-hidden">

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center gap-4 px-6 pt-4 pb-2 w-full max-w-md flex-1 justify-center">
        {/* Title */}
        <h1 className="text-3xl font-bold tracking-tight -mt-4">Deep Focus</h1>

        {/* Mode switcher */}
        <div className="flex rounded-full border border-gray-300 bg-white/70 backdrop-blur p-1 mb-10">
          {(["focus", "short", "long"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              disabled={running}
              className={`rounded-full px-5 py-2 text-sm font-medium transition ${
                mode === m
                  ? "bg-black text-white shadow-sm"
                  : "text-gray-600 hover:text-black disabled:opacity-50"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {/* Timer display */}
        {editingTime ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="180"
              value={editMinutes}
              onChange={(e) => setEditMinutes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const mins = Math.max(1, Math.min(180, Number(editMinutes) || 1));
                  setTotalDuration(mins * 60);
                  setTimeLeft(mins * 60);
                  setEditingTime(false);
                }
                if (e.key === "Escape") setEditingTime(false);
              }}
              onBlur={() => {
                const mins = Math.max(1, Math.min(180, Number(editMinutes) || 1));
                setTotalDuration(mins * 60);
                setTimeLeft(mins * 60);
                setEditingTime(false);
              }}
              autoFocus
              className="w-28 text-center text-5xl font-bold tracking-tight tabular-nums bg-transparent border-b-2 border-black outline-none"
            />
            <span className="text-lg text-gray-500 font-medium">min</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (!running) {
                setEditMinutes(String(Math.ceil(timeLeft / 60)));
                setEditingTime(true);
              }
            }}
            disabled={running}
            className="text-7xl font-bold tracking-tight tabular-nums hover:text-black/70 transition disabled:hover:text-black cursor-text"
          >
            {formatTime(timeLeft)}
          </button>
        )}

        {/* Start / Pause / Resume button */}
        {isIdle || isFinished ? (
          <button
            type="button"
            onClick={handleStart}
            disabled={saving}
            className="bg-black text-white px-8 py-3 rounded-full text-sm font-semibold tracking-wide hover:bg-black/90 transition disabled:opacity-60"
          >
            {isFinished ? "Start again" : "Start focus session"}
          </button>
        ) : isPaused ? (
          <button
            type="button"
            onClick={handleResume}
            className="bg-black text-white px-8 py-3 rounded-full text-sm font-semibold tracking-wide hover:bg-black/90 transition"
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePause}
            className="bg-black text-white px-8 py-3 rounded-full text-sm font-semibold tracking-wide hover:bg-black/90 transition"
          >
            Pause
          </button>
        )}

        {/* Controls */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handlePause}
            disabled={!running}
            aria-label="Pause"
            className="rounded-full border border-gray-300 bg-white/70 backdrop-blur p-3 hover:bg-white transition disabled:opacity-30"
          >
            <Pause size={20} />
          </button>
          <button
            type="button"
            onClick={handleReset}
            aria-label="Reset"
            className="rounded-full border border-gray-300 bg-white/70 backdrop-blur p-3 hover:bg-white transition"
          >
            <RotateCcw size={20} />
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={isIdle}
            aria-label="Stop and save"
            className="rounded-full border border-gray-300 bg-white/70 backdrop-blur p-3 hover:bg-white transition disabled:opacity-30"
          >
            <Square size={20} />
          </button>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="relative z-10 w-full flex items-center justify-between px-8 py-3 shrink-0">
        <button
          type="button"
          onClick={() => setSoundEnabled((v) => !v)}
          className="flex items-center gap-2 rounded-full border border-gray-300 bg-white/80 backdrop-blur px-4 py-2 text-sm font-medium hover:bg-white transition"
        >
          {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          Sound
        </button>

        <div className="flex items-center gap-3">
          <div className="rounded-full border border-gray-300 bg-white/80 backdrop-blur px-4 py-2 text-sm font-medium">
            Sessions <span className="font-bold ml-1">{totalSessions}</span>
          </div>
          <div className="rounded-full border border-gray-300 bg-white/80 backdrop-blur px-4 py-2 text-sm font-medium">
            Streak <span className="font-bold ml-1">{streak}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
