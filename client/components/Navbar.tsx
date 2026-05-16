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
  const authRoutes = new Set([
    "/",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
  ]);
  const hideNav = authRoutes.has(pathname);
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

    const pingActivity = () => {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
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
    };

    // Defer streak ping so it does not compete with page data on first paint
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(pingActivity, { timeout: 4000 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timerId = window.setTimeout(pingActivity, 2000);
    return () => window.clearTimeout(timerId);
  }, [hideNav]);

  if (hideNav) return null;

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <Link
            href="/dashboard"
            className="text-muted-foreground tracking-[0.18em] sm:tracking-[0.22em] text-sm sm:text-base hover:text-foreground"
          >
            FOCUSFLOW
          </Link>
          <nav className="hidden md:flex gap-6 text-sm">
            <NavLink href="/dashboard" label="Dashboard" />
            <NavLink href="/goals" label="Goals" />
            <NavLink href="/tasks" label="Tasks" />
            <NavLink href="/focus" label="Focus" />
            <NavLink href="/analytics" label="Analytics" />
            <NavLink href="/journal" label="Journal" />
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
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
              className="h-8 w-8 sm:h-9 sm:w-9 rounded-full border border-border flex items-center justify-center text-sm text-foreground hover:bg-card-muted"
              aria-label="Account settings"
            >
              <span className="tabular-nums tracking-tight">
                {avatarInitials ?? "…"}
              </span>
            </button>
          </div>
        </div>
        <div className="md:hidden border-t border-border/80 px-4 pb-2 pt-1 overflow-x-auto">
          <nav className="flex min-w-max items-center gap-4 text-sm">
            <NavLink href="/dashboard" label="Dashboard" />
            <NavLink href="/goals" label="Goals" />
            <NavLink href="/tasks" label="Tasks" />
            <NavLink href="/focus" label="Focus" />
            <NavLink href="/analytics" label="Analytics" />
            <NavLink href="/journal" label="Journal" />
          </nav>
        </div>
      </header>
      <div aria-hidden className="h-[92px] md:h-[73px]" />
    </>
  );
}
