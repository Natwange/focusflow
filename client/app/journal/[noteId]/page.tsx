"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { MoreHorizontal, ArrowLeft, Trash2, Save } from "lucide-react";

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

function useDebouncedCallback<T extends (...args: any[]) => void>(cb: T, delay = 600) {
  const timer = useRef<number | null>(null);
  return (...args: Parameters<T>) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => cb(...args), delay);
  };
}

function FontPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-lg border px-2 py-1 text-xs",
        active ? "border-black bg-black text-white" : "border-black/20 hover:bg-black/[0.03]"
      )}
    >
      {label}
    </button>
  );
}

export default function JournalNotePage() {
  const params = useParams();
  const router = useRouter();
  const noteId = params.noteId as string;

  const [note, setNote] = useState<JournalNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftFont, setDraftFont] = useState<FontStyle>("balanced");

  const fontClass =
    draftFont === "playful"
      ? "font-journal-playful"
      : draftFont === "professional"
        ? "font-journal-pro"
        : "font-journal-balanced";

  useEffect(() => {
    const token = getToken();
    if (!token || !noteId) {
      setLoading(false);
      setError("Missing note or not signed in.");
      return;
    }
    api(`/journal/notes/${noteId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data: JournalNote) => {
        setNote(data);
        setDraftTitle(data.title ?? "");
        setDraftContent(data.content ?? "");
        setDraftFont((data.font_style as FontStyle) ?? "balanced");
      })
      .catch(() => setError("Note not found."))
      .finally(() => setLoading(false));
  }, [noteId]);

  const debouncedSave = useDebouncedCallback(async (payload: Partial<JournalNote>) => {
    const token = getToken();
    if (!token || !noteId) return;
    setSaveStatus("saving");
    try {
      const updated = await api(`/journal/notes/${noteId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...(payload.title !== undefined && { title: payload.title }),
          ...(payload.content !== undefined && { content: payload.content }),
          ...(payload.font_style !== undefined && { font_style: payload.font_style }),
        }),
      });
      setSaveStatus("saved");
      setNote(updated);
    } catch {
      setSaveStatus("error");
    }
  }, 650);

  function manualSave() {
    debouncedSave({
      title: draftTitle,
      content: draftContent,
      font_style: draftFont,
    });
  }

  async function handleDelete() {
    const token = getToken();
    if (!token || !noteId) return;
    try {
      await api(`/journal/notes/${noteId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      router.replace("/journal");
    } catch {
      setSaveStatus("error");
    }
  }

  function onChangeTitle(v: string) {
    setDraftTitle(v);
    debouncedSave({ title: v, font_style: draftFont });
  }

  function onChangeContent(v: string) {
    setDraftContent(v);
    debouncedSave({ content: v, font_style: draftFont });
  }

  function onChangeFont(v: FontStyle) {
    setDraftFont(v);
    debouncedSave({ font_style: v, title: draftTitle, content: draftContent });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white text-black flex items-center justify-center">
        <p className="text-black/60">Loading note…</p>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="min-h-screen bg-white text-black flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-black/60">{error ?? "Note not found."}</p>
        <Link href="/journal" className="text-sm underline">
          Back to journal
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <main className="mx-auto max-w-3xl px-6 py-6">
        <div className="rounded-2xl border border-black/25 bg-white overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
            <Link
              href="/journal"
              className="flex items-center gap-2 text-sm text-black/70 hover:text-black"
            >
              <ArrowLeft size={18} />
              Back to journal
            </Link>

            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="h-9 w-9 rounded-full border border-black/20 hover:bg-black/[0.03] flex items-center justify-center"
                  aria-label="Note options"
                >
                  <MoreHorizontal size={18} />
                </button>

                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-black/20 bg-white shadow-lg p-3 z-10">
                    <div className="text-xs font-semibold mb-2">Font style</div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <FontPill label="Playful" active={draftFont === "playful"} onClick={() => onChangeFont("playful")} />
                      <FontPill label="Balanced" active={draftFont === "balanced"} onClick={() => onChangeFont("balanced")} />
                      <FontPill label="Pro" active={draftFont === "professional"} onClick={() => onChangeFont("professional")} />
                    </div>
                    <div className="h-px bg-black/10 my-2" />
                    <button
                      type="button"
                      onClick={manualSave}
                      className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-black/[0.03]"
                    >
                      <Save size={16} />
                      Save now
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-black/[0.03] text-red-600"
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="p-4">
            <input
              value={draftTitle}
              onChange={(e) => onChangeTitle(e.target.value)}
              placeholder="Give this note a short title"
              className="w-full bg-transparent outline-none text-lg font-medium placeholder:text-black/35 border-0 mb-4"
            />

            <div className="paper-bg rounded-2xl border border-black/15 p-5">
              <textarea
                value={draftContent}
                onChange={(e) => onChangeContent(e.target.value)}
                placeholder="Write what worked today, what didn't, and one tiny next step…"
                className={cx(
                  "w-full min-h-[340px] resize-none bg-transparent outline-none text-[20px] leading-[1.65] ink-text",
                  fontClass
                )}
              />
            </div>

            <div className="flex items-center justify-between mt-3 text-xs text-black/50 px-1">
              <span>Notes auto-save as you type.</span>
              <span>
                {saveStatus === "saving"
                  ? "Saving…"
                  : saveStatus === "saved"
                    ? "Saved"
                    : saveStatus === "error"
                      ? "Save failed"
                      : "Ready"}
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
