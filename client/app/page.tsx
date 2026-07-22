"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MaintenanceNotice } from "@/components/MaintenanceNotice";
import { api } from "@/lib/api";

export default function HomePage() {
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api("/me");
        if (!cancelled) {
          setRedirecting(true);
          router.replace("/dashboard");
        }
      } catch {
        /* landing stays visible for signed-out visitors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] text-gray-900 px-4 py-8 md:py-12 relative">
      {redirecting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#FAFAFA]/90 text-gray-600 text-sm">
          Opening your dashboard…
        </div>
      )}
      <div className="w-full max-w-5xl">
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-10 md:px-12 md:py-12">
          <header className="flex flex-wrap items-center justify-between gap-4 pb-10 md:pb-12 border-b border-gray-100">
            <p className="text-xs tracking-[0.22em] text-black/55 font-normal">FOCUSFLOW</p>
            <nav className="flex items-center gap-6 text-sm">
              <Link href="/login" className="text-gray-700 hover:text-gray-900 font-medium">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="text-gray-700 hover:text-gray-900 font-medium underline-offset-4 hover:underline"
              >
                Get started
              </Link>
            </nav>
          </header>

          <MaintenanceNotice className="mt-6" />

          <section className="pt-10 md:pt-12">
            <div className="space-y-6 min-w-0">
              <h1 className="text-[1.65rem] sm:text-3xl md:text-[2.15rem] lg:text-[2.35rem] font-bold leading-[1.15] tracking-tight text-gray-900">
                FocusFlow. Plan less. Finish more.
              </h1>
              <p className="text-base text-gray-600 leading-relaxed max-w-xl">
                Break big goals into daily work, stay consistent, and adjust when you fall behind.
              </p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-full bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
                >
                  Get started
                </Link>
                <Link
                  href="/login"
                  className="text-sm font-medium text-gray-600 underline-offset-4 hover:text-gray-900 hover:underline"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </section>

          <section className="mt-12 md:mt-14 pt-10 md:pt-12 border-t border-gray-100 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
              <p className="text-sm text-gray-900 leading-relaxed">
                ✓ Turn big goals into daily tasks
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
              <p className="text-sm text-gray-900 leading-relaxed">
                ✓ See when you&apos;re falling behind
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
              <p className="text-sm text-gray-900 leading-relaxed">
                ✓ Rebalance your schedule instantly
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
