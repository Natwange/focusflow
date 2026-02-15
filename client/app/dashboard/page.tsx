"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function DashboardPage() {
  const [goals, setGoals] = useState<any[]>([]);
  const [goalsError, setGoalsError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    setGoalsError(null);
    api("/goals", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(setGoals)
      .catch((err) => {
        console.error(err);
        setGoalsError(err instanceof Error ? err.message : "Failed to load goals");
      });
  }, []);

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <main className="max-w-6xl mx-auto px-6 pt-10 pb-20 space-y-10">
        {goalsError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {goalsError}
          </div>
        )}
        {/* HERO */}
        <section className="border rounded-2xl p-10 flex items-center justify-between">
          <div className="max-w-xl space-y-4">
            <h1 className="text-3xl font-semibold leading-tight">
              Stay consistent. Finish
              <br />
              what you start.
            </h1>
            <p className="text-gray-600">
              A calm space to plan your day, focus deeply,
              <br />
              and build momentum.
            </p>

            <div className="flex gap-3 pt-2">
            <Link
              href="/focus"
              className="bg-black text-white px-5 py-2 rounded-lg text-sm inline-flex items-center justify-center"
            >
              Start focus session
            </Link>
            <Link
              href="/plans/today"
              className="border px-5 py-2 rounded-lg text-sm inline-flex items-center justify-center"
            >
              View today’s plan
            </Link>
            </div>
          </div>

          {/* Illustration placeholder (black & white only) */}
          <Image
            src="/illustrations/dashboardImage.png"
            alt="Focus and plan your day"
            width={300}
            height={200}
            className="opacity-90 grayscale md:-translate-x-4 object-contain"
          />

        </section>

        {/* GRID */}
        <section className="grid grid-cols-3 gap-6">
          {/* TODAY'S PLAN */}
          <div className="col-span-2 border rounded-2xl p-6">
            <h2 className="text-lg font-semibold tracking-tight">Today’s Plan</h2>

            <div className="space-y-3 text-sm">
              <PlanItem href="/tasks" time="9:00 AM" label="Lessons 1–2 (30 Days of JS)" />
              <PlanItem href="/tasks" time="9:30 AM" label="Workout: Lower body" status="Doing" />
              <PlanItem href="/tasks" time="8:30 PM" label="Review notes (15 min)" />
            </div>

            <div className="flex gap-3 mt-6">
              <button className="bg-black text-white px-4 py-2 rounded-lg text-sm">
                Start focus session
              </button>
              <button className="border px-4 py-2 rounded-lg text-sm">
                Add task
              </button>
            </div>
          </div>

          {/* PROGRESS */}
          <div className="border rounded-2xl p-6 space-y-5">
            <h2 className="text-lg font-semibold tracking-tight">Your Progress</h2>

            <div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-black w-2/5" />
              </div>
              <p className="text-sm mt-2">2 / 5 tasks</p>
            </div>

            <div className="flex justify-between text-sm">
              <div>
                <p className="text-gray-500">Streak</p>
                <p className="font-medium">3 days</p>
              </div>
              <div>
                <p className="text-gray-500">Focus time</p>
                <p className="font-medium">1h 25m</p>
              </div>
            </div>

            <p className="text-xs text-gray-500">
              You finish more tasks in the evening.
              Plan heavier work after 4 PM.
            </p>
          </div>
        </section>

        {/* QUICK ACTIONS */}
      <section className="bg-white border border-gray-200 rounded-3xl p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tracking-tight">Quick Actions</h2>
          <span className="text-xs uppercase tracking-[0.18em] text-gray-400">
            Today
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Create Goal */}
          <button
            className="group flex flex-col items-start justify-between rounded-2xl border border-gray-200 bg-[#F9F9F9] px-4 py-3 text-left transition hover:-translate-y-[1px] hover:border-gray-300 hover:shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-xs font-medium">
                G
              </div>
              <div>
                <p className="text-sm font-medium">Create Goal</p>
                <p className="text-xs text-gray-500">Plan a deadline</p>
              </div>
            </div>
            <span className="mt-2 text-[11px] text-gray-400 group-hover:text-gray-500">
              Set a north star for your work
            </span>
          </button>

          {/* Generate Plan */}
          <button
            className="group flex flex-col items-start justify-between rounded-2xl border border-gray-200 bg-[#F9F9F9] px-4 py-3 text-left transition hover:-translate-y-[1px] hover:border-gray-300 hover:shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-xs font-medium">
                P
              </div>
              <div>
                <p className="text-sm font-medium">Generate Plan</p>
                <p className="text-xs text-gray-500">Split work into days</p>
              </div>
            </div>
            <span className="mt-2 text-[11px] text-gray-400 group-hover:text-gray-500">
              Auto-create tasks from your goal
            </span>
          </button>

          {/* Start Focus */}
          <button
            className="group flex flex-col items-start justify-between rounded-2xl border border-gray-200 bg-[#F9F9F9] px-4 py-3 text-left transition hover:-translate-y-[1px] hover:border-gray-300 hover:shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-xs font-medium">
                ⏱
              </div>
              <div>
                <p className="text-sm font-medium">Start Focus</p>
                <p className="text-xs text-gray-500">Track a deep-work block</p>
              </div>
            </div>
            <span className="mt-2 text-[11px] text-gray-400 group-hover:text-gray-500">
              Log a 25–60 minute session
            </span>
          </button>

          {/* Journal Entry */}
          <Link
            href="/journal"
            className="group flex flex-col items-start justify-between rounded-2xl border border-gray-200 bg-[#F9F9F9] px-4 py-3 text-left transition hover:-translate-y-[1px] hover:border-gray-300 hover:shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-xs font-medium">
                ✎
              </div>
              <div>
                <p className="text-sm font-medium">Journal Entry</p>
                <p className="text-xs text-gray-500">What worked today?</p>
              </div>
            </div>
            <span className="mt-2 text-[11px] text-gray-400 group-hover:text-gray-500">
              Capture one win + one lesson
            </span>
          </Link>
        </div>
      </section>
      </main>
      {/*
      //Footer 
      <footer className="fixed bottom-0 left-0 w-full bg-black text-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between text-sm">
          <span className="font-medium tracking-wide">FOCUSFLOW</span>
          <span className="opacity-70">
            © 2026 · Stay consistent. Finish what you start.
          </span>
        </div>
      </footer>*/}
    </div>
  );
}

/* ---------- Helpers ---------- */

function PlanItem({
  href,
  time,
  label,
  status,
}: {
  href: string;
  time: string;
  label: string;
  status?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-xl p-2 -m-2 hover:bg-gray-50 transition"
    >
      <div className="flex items-center gap-3">
        <div className="w-4 h-4 border rounded-full" />
        <div>
          <p className="text-sm">{label}</p>
          <p className="text-xs text-gray-500">{time}</p>
        </div>
      </div>
      {status && <span className="text-xs text-gray-500">{status}</span>}
    </Link>
  );
}

function QuickAction({
  href,
  title,
  subtitle,
}: {
  href: string;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="border rounded-xl p-4 hover:bg-gray-50 transition block"
    >
      <p className="font-medium text-sm">{title}</p>
      <p className="text-xs text-gray-500">{subtitle}</p>
    </Link>
  );
}

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


