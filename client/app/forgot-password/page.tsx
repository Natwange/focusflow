"use client";

import Link from "next/link";
import { useState } from "react";

import { api } from "@/lib/api";
import { isReasonableEmail, normalizeEmail } from "@/lib/emailValidation";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = isReasonableEmail(email);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!isReasonableEmail(email)) {
      setErr("Enter a valid email with a domain (for example you@gmail.com).");
      return;
    }
    setLoading(true);
    try {
      await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: normalizeEmail(email) }),
      });
      setDone(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="ff-page grid place-items-center px-6">
      <section className="relative z-10 w-full max-w-md">
        <div className="rounded-2xl border border-gray-200 bg-white px-7 py-8 shadow-sm">
          <p className="text-xs tracking-[0.22em] text-black/40">FOCUSFLOW</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-black">
            Forgot password
          </h1>
          <p className="mt-1 text-sm text-black/55">
            We&apos;ll email you a link to choose a new password.
          </p>

          {done ? (
            <div className="mt-7 space-y-4">
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                If an account exists for that email, we sent password reset
                instructions. Check your inbox and spam folder.
              </p>
              <Link
                href="/login"
                className="inline-block text-sm font-medium text-black underline underline-offset-4 hover:opacity-80"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-7 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-black/60">Email</label>
                <input
                  type="email"
                  className="w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/30 outline-none transition focus:border-black/25 focus:ring-4 focus:ring-[#8FABD4]/25"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  inputMode="email"
                />
              </div>
              {err && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {err}
                </div>
              )}
              <button
                type="submit"
                disabled={loading || !canSubmit}
                className="mt-2 w-full rounded-lg bg-black py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-black/90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? "Sending…" : "Send reset link"}
              </button>
              <div className="pt-1 text-center text-xs text-black/55">
                <Link
                  href="/login"
                  className="font-medium text-black underline underline-offset-4 hover:opacity-80"
                >
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
