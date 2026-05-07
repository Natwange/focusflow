"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { api } from "@/lib/api";
import { Plus } from "lucide-react";

function reflectionStorageKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `focusflow-journal-reflection-${y}-${m}-${day}`;
}

type FontStyle = "playful" | "balanced" | "professional";

type JournalNote = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  font_style: FontStyle;
  created_at: string;
  updated_at: string;
};

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

export default function JournalPage() {
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<JournalNote[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [createNoteLoading, setCreateNoteLoading] = useState(false);
  const [createNoteError, setCreateNoteError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reflectionText, setReflectionText] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(reflectionStorageKey());
      if (saved != null) setReflectionText(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(reflectionStorageKey(), reflectionText);
    } catch {
      /* ignore */
    }
  }, [reflectionText]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await api("/journal/notes");
        setNotes(Array.isArray(data) ? data : []);
      } catch (e: any) {
        setNotes([]);
        const msg = e?.message || String(e);
        if (msg.includes("NEXT_PUBLIC_API_URL")) {
          setLoadError("API URL not set. Add NEXT_PUBLIC_API_URL=http://localhost:4000 to client/.env.local");
        } else if (msg === "Authentication required") {
          setLoadError("Sign in to see and create notes.");
        } else if (msg.includes("401")) {
          setLoadError("Session expired or invalid. Try signing in again.");
        } else {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || "(not set)";
          setLoadError(
            `Couldn’t load notes: ${msg}. Open ${apiUrl}/health in your browser — if it doesn’t load, the API server isn’t reachable (wrong port or not running).`
          );
        }
      }
      setLoading(false);
    })();
  }, []);

  async function createNote() {
    setCreateNoteError(null);
    setCreateNoteLoading(true);
    try {
      const newNote = await api("/journal/notes", {
        method: "POST",
        body: JSON.stringify({ title: "", content: "", font_style: "balanced" }),
      });
      setNotes((prev) => [newNote, ...prev]);
      window.location.href = `/journal/${encodeURIComponent(newNote.id)}`;
    } catch (e: any) {
      setCreateNoteError(e?.message || "Failed to create note.");
    } finally {
      setCreateNoteLoading(false);
    }
  }

  return (
    <div className="ff-page">
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-8">
        {/* Hero */}
        <section className="border border-gray-200 rounded-2xl bg-white p-5 sm:p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6 shadow-sm">
          <div className="max-w-xl space-y-3">
            <h1 className="text-2xl md:text-3xl font-semibold leading-snug text-gray-900">
              Turn today into a page
              <br />
              worth re-reading.
            </h1>
            <p className="text-sm text-gray-600 leading-relaxed">
              Write what worked, what didn&apos;t, and one tiny move for tomorrow.
            </p>
            <div className="flex items-center gap-2 pt-0.5 text-[11px] text-gray-400">
              <span>Auto-save on</span>
              <span aria-hidden>•</span>
              <span>{saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : "Ready"}</span>
            </div>
            <button
              type="button"
              onClick={createNote}
              disabled={createNoteLoading}
              className="mt-1 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm transition hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {createNoteLoading ? "Creating…" : "New note"}
            </button>
          </div>

          <Image
            src="/illustrations/better_journal_page_image.png"
            alt="Journal – turn today into a page worth re-reading"
            width={260}
            height={174}
            className="opacity-95 object-contain w-full max-w-[240px] self-center md:self-auto shrink-0 md:-translate-x-2"
          />
        </section>

        {/* Today’s reflection */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 tracking-tight">
            Today&apos;s Reflection
          </h2>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Optional prompts — write as much or as little as you like. This draft stays on this
            device for today.
          </p>
          <ul className="text-xs text-gray-500 space-y-1.5 list-none pl-0">
            <li className="flex gap-2">
              <span className="text-gray-300 shrink-0" aria-hidden>
                •
              </span>
              <span>What did you accomplish?</span>
            </li>
            <li className="flex gap-2">
              <span className="text-gray-300 shrink-0" aria-hidden>
                •
              </span>
              <span>What distracted you?</span>
            </li>
            <li className="flex gap-2">
              <span className="text-gray-300 shrink-0" aria-hidden>
                •
              </span>
              <span>What will you do differently tomorrow?</span>
            </li>
          </ul>
          <label htmlFor="journal-reflection" className="sr-only">
            Today&apos;s reflection
          </label>
          <textarea
            id="journal-reflection"
            value={reflectionText}
            onChange={(e) => setReflectionText(e.target.value)}
            rows={6}
            placeholder="Jot your thoughts here…"
            className="w-full rounded-xl border border-gray-200 bg-[#FAFAFA] px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 resize-y min-h-[140px]"
          />
        </section>

        {/* Notes strip */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 md:p-5 shadow-sm">
          <div className="flex items-center justify-between px-2 pb-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Your notes</span>
              <button
                type="button"
                onClick={createNote}
                disabled={createNoteLoading}
                title="New note"
                aria-label="New note"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 disabled:opacity-60 shrink-0"
              >
                <Plus size={18} />
              </button>
            </div>
            <div className="text-xs text-gray-400">Auto-save on</div>
          </div>

          {loadError && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
              {loadError}
            </div>
          )}
          {createNoteError && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
              {createNoteError}
            </div>
          )}
          <div className="flex gap-4 overflow-x-auto pb-2 px-1">
            {loading ? (
              <div className="text-sm text-gray-500 p-4">Loading…</div>
            ) : notes.length === 0 ? (
              <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center w-full min-w-0">
                <button
                  type="button"
                  onClick={createNote}
                  disabled={createNoteLoading}
                  className="w-[180px] min-w-[180px] max-w-[180px] h-[110px] shrink-0 rounded-2xl border border-dashed border-gray-300 bg-[#FAFAFA] hover:bg-gray-100 hover:border-gray-400 flex flex-col justify-center px-4 text-left disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2 font-semibold text-gray-900">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 bg-white">
                      <Plus size={16} />
                    </span>
                    {createNoteLoading ? "Creating…" : "New note"}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    {createNoteLoading ? "Please wait…" : "Full page in the editor"}
                  </div>
                </button>
                <p className="text-sm text-gray-500 py-2 sm:py-0 sm:max-w-md leading-relaxed">
                  No entries yet — start with today&apos;s reflection.
                </p>
              </div>
            ) : (
              notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    window.location.href = `/journal/${encodeURIComponent(n.id)}`;
                  }}
                  className="w-[180px] min-w-[180px] max-w-[180px] h-[110px] shrink-0 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left hover:bg-gray-50 hover:border-gray-300 cursor-pointer overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-bold text-gray-900 text-sm truncate">
                      {n.title?.trim() ? n.title : "Untitled note"}
                    </div>
                    <div className="text-[10px] text-gray-400 whitespace-nowrap shrink-0 tabular-nums">
                      {new Date(n.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1.5 line-clamp-2 leading-snug">
                    {n.content?.trim() ? n.content : "Empty note — open to write."}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
