"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useFocusTimer, type FocusMode } from "@/context/FocusTimerContext";
import { Pause, RotateCcw, Square, Volume2, VolumeX } from "lucide-react";

type Mode = FocusMode;

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

export default function FocusPage() {
  const timer = useFocusTimer();

  const [totalSessions, setTotalSessions] = useState(0);
  const [streak, setStreak] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [editingTime, setEditingTime] = useState(false);
  const [editMinutes, setEditMinutes] = useState("");

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

  // Refresh stats when timer finishes (timeLeft transitions to 0)
  useEffect(() => {
    if (timer.timeLeft === 0 && !timer.running) {
      fetchStats();
    }
  }, [timer.timeLeft, timer.running, fetchStats]);

  const handleStart = () => {
    timer.startSession({
      durationMinutes: Math.round(timer.totalDuration / 60),
      mode: timer.mode,
    });
  };

  const isIdle = timer.isIdle;
  const isPaused = timer.isPaused;
  const isFinished = !timer.running && timer.timeLeft === 0;

  return (
    <div className="h-[calc(100vh-56px)] bg-[#FAFAFA] text-black dark:bg-[#0b0c0f] dark:text-[#f5f7fb] flex flex-col items-center justify-between relative overflow-hidden">

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center gap-4 px-6 pt-4 pb-2 w-full max-w-md flex-1 justify-center">
        {/* Title */}
        <h1 className="text-3xl font-bold tracking-tight -mt-4">Deep Focus</h1>

        {/* Mode switcher */}
        <div className="flex rounded-full border border-gray-300 bg-white/70 backdrop-blur p-1 mb-10 dark:border-[#2a303a] dark:bg-[#171a20]/90">
          {(["focus", "short", "long"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => timer.switchMode(m)}
              disabled={timer.running}
              className={`rounded-full px-5 py-2 text-sm font-medium transition ${
                timer.mode === m
                  ? "bg-black text-white shadow-sm dark:bg-white dark:text-[#0b0c0f]"
                  : "text-gray-600 hover:text-black disabled:opacity-50 dark:text-[#b8bec9] dark:hover:text-[#f5f7fb]"
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
                  timer.setDuration(mins);
                  setEditingTime(false);
                }
                if (e.key === "Escape") setEditingTime(false);
              }}
              onBlur={() => {
                const mins = Math.max(1, Math.min(180, Number(editMinutes) || 1));
                timer.setDuration(mins);
                setEditingTime(false);
              }}
              autoFocus
              className="w-28 text-center text-5xl font-bold tracking-tight tabular-nums bg-transparent border-b-2 border-black outline-none dark:border-[#f5f7fb] dark:text-[#f5f7fb]"
            />
            <span className="text-lg text-gray-500 font-medium dark:text-[#b8bec9]">min</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (!timer.running) {
                setEditMinutes(String(Math.ceil(timer.timeLeft / 60)));
                setEditingTime(true);
              }
            }}
            disabled={timer.running}
            className="text-7xl font-bold tracking-tight tabular-nums hover:text-black/70 transition disabled:hover:text-black cursor-text dark:hover:text-white/80 dark:disabled:hover:text-[#f5f7fb]"
          >
            {formatTime(timer.timeLeft)}
          </button>
        )}

        {/* Start / Pause / Resume button */}
        {isIdle || isFinished ? (
          <button
            type="button"
            onClick={handleStart}
            className="bg-black text-white px-8 py-3 rounded-full text-sm font-semibold tracking-wide hover:bg-black/90 transition disabled:opacity-60 dark:bg-white dark:text-[#0b0c0f] dark:hover:bg-white/90"
          >
            {isFinished ? "Start again" : "Start focus session"}
          </button>
        ) : isPaused ? (
          <button
            type="button"
            onClick={timer.resume}
            className="bg-black text-white px-8 py-3 rounded-full text-sm font-semibold tracking-wide hover:bg-black/90 transition dark:bg-white dark:text-[#0b0c0f] dark:hover:bg-white/90"
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={timer.pause}
            className="bg-black text-white px-8 py-3 rounded-full text-sm font-semibold tracking-wide hover:bg-black/90 transition dark:bg-white dark:text-[#0b0c0f] dark:hover:bg-white/90"
          >
            Pause
          </button>
        )}

        {/* Controls */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={timer.pause}
            disabled={!timer.running}
            aria-label="Pause"
            className="rounded-full border border-gray-300 bg-white/70 backdrop-blur p-3 hover:bg-white transition disabled:opacity-30 dark:border-[#2a303a] dark:bg-[#171a20] dark:hover:bg-[#1c2028]"
          >
            <Pause size={20} />
          </button>
          <button
            type="button"
            onClick={timer.reset}
            aria-label="Reset"
            className="rounded-full border border-gray-300 bg-white/70 backdrop-blur p-3 hover:bg-white transition dark:border-[#2a303a] dark:bg-[#171a20] dark:hover:bg-[#1c2028]"
          >
            <RotateCcw size={20} />
          </button>
          <button
            type="button"
            onClick={timer.stop}
            disabled={isIdle}
            aria-label="Stop and save"
            className="rounded-full border border-gray-300 bg-white/70 backdrop-blur p-3 hover:bg-white transition disabled:opacity-30 dark:border-[#2a303a] dark:bg-[#171a20] dark:hover:bg-[#1c2028]"
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
          className="flex items-center gap-2 rounded-full border border-gray-300 bg-white/80 backdrop-blur px-4 py-2 text-sm font-medium hover:bg-white transition dark:border-[#2a303a] dark:bg-[#171a20] dark:text-[#f5f7fb] dark:hover:bg-[#1c2028]"
        >
          {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          Sound
        </button>

        <div className="flex items-center gap-3">
          <div className="rounded-full border border-gray-300 bg-white/80 backdrop-blur px-4 py-2 text-sm font-medium dark:border-[#2a303a] dark:bg-[#171a20] dark:text-[#f5f7fb]">
            Sessions <span className="font-bold ml-1">{totalSessions}</span>
          </div>
          <div className="rounded-full border border-gray-300 bg-white/80 backdrop-blur px-4 py-2 text-sm font-medium dark:border-[#2a303a] dark:bg-[#171a20] dark:text-[#f5f7fb]">
            Streak <span className="font-bold ml-1">{streak}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
