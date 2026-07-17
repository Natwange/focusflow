"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MoreHorizontal, ArrowLeft, Trash2, Save, CheckCircle2 } from "lucide-react";

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

function useDebouncedCallback<Args extends unknown[]>(
  cb: (...args: Args) => void,
  delay = 600
) {
  const timer = useRef<number | null>(null);
  return (...args: Args) => {
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
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-foreground hover:bg-card-muted"
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveToastOpen, setSaveToastOpen] = useState(false);

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
    if (!noteId) {
      setLoading(false);
      setError("Missing note.");
      return;
    }
    api(`/journal/notes/${noteId}`)
      .then((data: JournalNote) => {
        setNote(data);
        setDraftTitle(data.title ?? "");
        setDraftContent(data.content ?? "");
        setDraftFont((data.font_style as FontStyle) ?? "balanced");
      })
      .catch(() => setError("Note not found."))
      .finally(() => setLoading(false));
  }, [noteId]);

  useEffect(() => {
    if (!saveToastOpen) return;
    const timer = window.setTimeout(() => setSaveToastOpen(false), 3500);
    return () => window.clearTimeout(timer);
  }, [saveToastOpen]);

  async function persistNote(payload: Partial<JournalNote>): Promise<boolean> {
    if (!noteId) return false;
    setSaveStatus("saving");
    try {
      const updated = await api(`/journal/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(payload.title !== undefined && { title: payload.title }),
          ...(payload.content !== undefined && { content: payload.content }),
          ...(payload.font_style !== undefined && { font_style: payload.font_style }),
        }),
      });
      setSaveStatus("saved");
      setNote(updated);
      return true;
    } catch {
      setSaveStatus("error");
      return false;
    }
  }

  const debouncedSave = useDebouncedCallback((payload: Partial<JournalNote>) => {
    void persistNote(payload);
  }, 650);

  async function manualSave() {
    setMenuOpen(false);
    const ok = await persistNote({
      title: draftTitle,
      content: draftContent,
      font_style: draftFont,
    });
    if (ok) setSaveToastOpen(true);
  }

  function requestDelete() {
    setMenuOpen(false);
    setDeleteConfirmOpen(true);
  }

  async function executeDelete() {
    if (!noteId) return;
    setDeleteConfirmOpen(false);
    try {
      await api(`/journal/notes/${noteId}`, {
        method: "DELETE",
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
      <div className="ff-page flex items-center justify-center">
        <p className="text-muted-foreground">Loading note…</p>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="ff-page flex flex-col items-center justify-center gap-4 p-6 min-h-screen">
        <p className="text-muted-foreground">{error ?? "Note not found."}</p>
        <Link href="/journal" className="text-sm text-foreground underline">
          Back to journal
        </Link>
      </div>
    );
  }

  return (
    <div className="ff-page">
      <main className="mx-auto max-w-3xl px-6 py-6">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <Link
              href="/journal"
              className="flex items-center gap-2 text-sm text-foreground hover:text-foreground/80"
            >
              <ArrowLeft size={18} />
              Back to journal
            </Link>

            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="h-9 w-9 rounded-full border border-border text-foreground hover:bg-card-muted flex items-center justify-center"
                  aria-label="Note options"
                >
                  <MoreHorizontal size={18} />
                </button>

                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-card text-foreground shadow-lg p-3 z-10">
                    <div className="text-xs font-semibold mb-2">Font style</div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <FontPill label="Playful" active={draftFont === "playful"} onClick={() => onChangeFont("playful")} />
                      <FontPill label="Balanced" active={draftFont === "balanced"} onClick={() => onChangeFont("balanced")} />
                      <FontPill label="Pro" active={draftFont === "professional"} onClick={() => onChangeFont("professional")} />
                    </div>
                    <div className="h-px bg-border my-2" />
                    <button
                      type="button"
                      onClick={() => void manualSave()}
                      className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-card-muted"
                    >
                      <Save size={16} />
                      Save now
                    </button>
                    <button
                      type="button"
                      onClick={requestDelete}
                      className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-card-muted"
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
              className="w-full bg-transparent outline-none text-lg font-medium text-foreground placeholder:text-muted-foreground border-0 mb-4"
            />

            <div className="paper-bg rounded-2xl border border-border p-5">
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

            <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground px-1">
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

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Are you sure?"
        message="This permanently deletes the note. You can't undo this."
        confirmLabel="Delete note"
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => void executeDelete()}
      />

      {saveToastOpen && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <CheckCircle2 size={18} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          Your note has been automatically saved.
        </div>
      )}
    </div>
  );
}
