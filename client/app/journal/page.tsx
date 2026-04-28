"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { api } from "@/lib/api";
import { Plus } from "lucide-react";

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
    <div className="min-h-screen bg-white text-black">
      <main className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        {/* Hero Card — same dimensions as dashboard "Stay consistent" card */}
        <section className="border rounded-2xl p-10 flex items-center justify-between">
          <div className="max-w-xl space-y-4">
            <h1 className="text-3xl font-semibold leading-tight">
              Turn today into a page
              <br />
              worth re-reading.
            </h1>
            <p className="text-gray-600">
              Write what worked, what didn't, and one tiny move for tomorrow.
            </p>
            <div className="flex items-center gap-2 pt-1 text-xs text-black/50">
              <span>Auto-save on</span>
              <span>•</span>
              <span>{saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : "Ready"}</span>
            </div>
            <button
              type="button"
              onClick={createNote}
              disabled={createNoteLoading}
              className="mt-3 rounded-full bg-black text-white px-5 py-2.5 text-sm font-medium hover:bg-black/90 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {createNoteLoading ? "Creating…" : "New note"}
            </button>
          </div>

          <Image
            src="/illustrations/better_journal_page_image.png"
            alt="Journal – turn today into a page worth re-reading"
            width={300}
            height={200}
            className="opacity-95 object-contain md:-translate-x-4"
          />
        </section>

        {/* Notes strip */}
        <section className="rounded-2xl border border-black/25 bg-white p-4">
          <div className="flex items-center justify-between px-2 pb-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Your notes</span>
              <button
                type="button"
                onClick={createNote}
                disabled={createNoteLoading}
                title="New note"
                aria-label="New note"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/25 hover:bg-black/[0.06] transition disabled:opacity-60 shrink-0"
              >
                <Plus size={18} />
              </button>
            </div>
            <div className="text-xs text-black/50">Auto-save on</div>
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
          <div className="flex gap-3 overflow-x-auto pb-2 px-1">
            {loading ? (
              <div className="text-sm text-black/50 p-4">Loading…</div>
            ) : notes.length === 0 ? (
              <>
                <button
                  type="button"
                  onClick={createNote}
                  disabled={createNoteLoading}
                  className="w-[180px] min-w-[180px] max-w-[180px] h-[110px] shrink-0 rounded-2xl border border-dashed border-black/40 bg-white hover:bg-black/[0.02] transition flex flex-col justify-center px-4 text-left disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/30">
                      <Plus size={16} />
                    </span>
                    {createNoteLoading ? "Creating…" : "New note"}
                  </div>
                  <div className="text-xs text-black/55 mt-1">
                    {createNoteLoading ? "Please wait…" : "Click to start a fresh page."}
                  </div>
                </button>
                <div className="text-sm text-black/50 p-4 flex items-center">No notes yet. Click “New note” or the + above to create one.</div>
              </>
            ) : (
              notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    window.location.href = `/journal/${encodeURIComponent(n.id)}`;
                  }}
                  className="w-[180px] min-w-[180px] max-w-[180px] h-[110px] shrink-0 rounded-2xl border border-black/25 bg-white px-4 py-3 text-left hover:bg-black/[0.02] transition cursor-pointer overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-semibold truncate">
                      {n.title?.trim() ? n.title : "Untitled note"}
                    </div>
                    <div className="text-[11px] text-black/50 whitespace-nowrap">
                      {new Date(n.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </div>
                  </div>
                  <div className="text-xs text-black/55 mt-1 line-clamp-2">
                    {n.content?.trim() ? n.content : "First line of the note appears here…"}
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
