"use client";

import { useFocusTimer } from "@/context/FocusTimerContext";
import { Pause, Play, Square } from "lucide-react";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function GlobalFocusTimerWidget() {
  const { isActive, running, isPaused, timeLeft, mode, pause, resume, stop } =
    useFocusTimer();

  if (!isActive) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-gray-300 bg-white/95 backdrop-blur shadow-lg px-4 py-2 text-sm font-medium dark:border-[#2a303a] dark:bg-[#171a20]/95 dark:text-[#f5f7fb] sm:bottom-6 sm:left-6">
      <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
      <span className="tabular-nums font-bold tracking-tight">
        {formatTime(timeLeft)}
      </span>
      <span className="text-xs text-gray-500 dark:text-[#9aa3b2] capitalize">
        {mode}
      </span>

      {running ? (
        <button
          type="button"
          onClick={pause}
          aria-label="Pause"
          className="ml-1 rounded-full p-1.5 hover:bg-gray-100 transition dark:hover:bg-[#1c2028]"
        >
          <Pause size={14} />
        </button>
      ) : isPaused ? (
        <button
          type="button"
          onClick={resume}
          aria-label="Resume"
          className="ml-1 rounded-full p-1.5 hover:bg-gray-100 transition dark:hover:bg-[#1c2028]"
        >
          <Play size={14} />
        </button>
      ) : null}

      <button
        type="button"
        onClick={stop}
        aria-label="Stop"
        className="rounded-full p-1.5 hover:bg-gray-100 transition dark:hover:bg-[#1c2028]"
      >
        <Square size={14} />
      </button>
    </div>
  );
}
