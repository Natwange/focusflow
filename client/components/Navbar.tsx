"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { api } from "@/lib/api";
import { getUserInitials } from "@/lib/userInitials";
import { useSettingsModal } from "@/components/settings/SettingsModalProvider";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={
        active
          ? "text-foreground border-b border-foreground pb-1"
          : "text-muted-foreground hover:text-foreground"
      }
    >
      {label}
    </Link>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const hideNav = pathname === "/login" || pathname === "/signup";
  const { openSettings } = useSettingsModal();

  const [streak, setStreak] = useState<number | null>(null);
  const [avatarInitials, setAvatarInitials] = useState<string | null>(null);

  useEffect(() => {
    if (hideNav) return;

    api("/me")
      .then((data) => {
        const u = data?.user;
        if (u && typeof u.email === "string") {
          setAvatarInitials(
            getUserInitials(
              typeof u.name === "string" ? u.name : null,
              u.email
            )
          );
        }
      })
      .catch(() => {
        setAvatarInitials("?");
      });

    const tzOffsetMinutes = new Date().getTimezoneOffset();
    // Ping activity so "visiting the app today" counts toward streak (Duolingo-style)
    api(`/activity/ping`, {
      method: "POST",
      body: JSON.stringify({ tzOffsetMinutes }),
    })
      .then((data) => {
        if (typeof data?.streak === "number") setStreak(data.streak);
      })
      .catch(() => {
        // silent in nav
      });
  }, [hideNav]);

  if (hideNav) return null;

  return (
    <header className="relative z-10 bg-background">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link
          href="/dashboard"
          className="text-muted-foreground tracking-[0.22em] hover:text-foreground"
        >
          FOCUSFLOW
        </Link>
        <nav className="flex gap-6 text-sm">
          <NavLink href="/dashboard" label="Dashboard" />
          <NavLink href="/goals" label="Goals" />
          <NavLink href="/tasks" label="Tasks" />
          <NavLink href="/focus" label="Focus" />
          <NavLink href="/analytics" label="Analytics" />
          <NavLink href="/journal" label="Journal" />
        </nav>
        <div className="flex items-center gap-3">
          {streak !== null && (
            <div className="hidden sm:inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-foreground bg-card-muted">
              <span className="text-muted-foreground">Streak</span>
              <span className="font-semibold text-foreground">{streak}d</span>
            </div>
          )}
          <button
            type="button"
            onClick={openSettings}
            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition hover:bg-card-muted hover:text-foreground"
            aria-label="Open settings"
          >
            <Settings size={18} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={openSettings}
            className="h-9 w-9 rounded-full border border-border flex items-center justify-center text-sm text-foreground hover:bg-card-muted"
            aria-label="Account settings"
          >
            <span className="tabular-nums tracking-tight">
              {avatarInitials ?? "…"}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
