"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={
        active
          ? "text-black border-b border-black pb-1"
          : "hover:text-black"
      }
    >
      {label}
    </Link>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const hideNav = pathname === "/login" || pathname === "/signup";
  if (hideNav) return null;

  return (
    <header>
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/dashboard" className="text-black/50 tracking-[0.22em] hover:text-black">
          FOCUSFLOW
        </Link>
        <nav className="flex gap-6 text-sm text-gray-600">
          <NavLink href="/dashboard" label="Dashboard" />
          <NavLink href="/goals" label="Goals" />
          <NavLink href="/tasks" label="Tasks" />
          <NavLink href="/focus" label="Focus" />
          <NavLink href="/analytics" label="Analytics" />
          <NavLink href="/journal" label="Journal" />
          <NavLink href="/settings" label="Settings" />
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="w-8 h-8 rounded-full border flex items-center justify-center text-sm hover:bg-gray-50"
          >
            JS
          </Link>
        </div>
      </div>
    </header>
  );
}
