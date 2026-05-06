"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { api } from "@/lib/api";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.6 5.1A9.2 9.2 0 0 1 12 5c6 0 9.7 5.4 10.8 7a1 1 0 0 1 0 1C22 14.5 19.4 18 15.4 19.5M9.2 6.1C5.6 7.7 3.3 10.9 2.2 12.5a1 1 0 0 0 0 1C3.3 15.1 6.9 20.5 12 20.5c1.7 0 3.2-.3 4.5-.9"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M9.9 9.9a3 3 0 0 0 4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M3 3l18 18"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.2 12.5C3.3 10.9 6.9 5.5 12 5.5s8.7 5.4 9.8 7a1 1 0 0 1 0 1C20.7 15.1 17.1 20.5 12 20.5s-8.7-5.4-9.8-7a1 1 0 0 1 0-1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M12 15.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit =
    token.length > 0 &&
    password.length >= 8 &&
    password === confirm;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await api("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: password }),
      });
      router.replace("/login?reset=1");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-7 py-8 shadow-sm">
        <p className="text-xs tracking-[0.22em] text-black/40">FOCUSFLOW</p>
        <h1 className="mt-3 text-2xl font-semibold text-black">Invalid link</h1>
        <p className="mt-2 text-sm text-black/55">
          This page needs a reset token from your email. Request a new link from
          the sign-in page.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-block text-sm font-medium text-black underline underline-offset-4"
        >
          Forgot password
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-7 py-8 shadow-sm">
      <p className="text-xs tracking-[0.22em] text-black/40">FOCUSFLOW</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-black">
        New password
      </h1>
      <p className="mt-1 text-sm text-black/55">Choose a password you haven&apos;t used here before.</p>

      <form onSubmit={onSubmit} className="mt-7 space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-black/60">New password</label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 pr-11 text-sm text-black outline-none transition focus:border-black/25 focus:ring-4 focus:ring-[#8FABD4]/25"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-black/45 hover:text-black/70"
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              <EyeIcon open={showPw} />
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-black/60">Confirm password</label>
          <input
            type={showPw ? "text" : "password"}
            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm text-black outline-none transition focus:border-black/25 focus:ring-4 focus:ring-[#8FABD4]/25"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
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
          className="w-full rounded-lg bg-black py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-black/90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? "Saving…" : "Update password"}
        </button>
        <div className="text-center text-xs text-black/55">
          <Link href="/login" className="underline underline-offset-4 hover:text-black">
            Back to sign in
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="ff-page grid place-items-center px-6">
      <section className="relative z-10 w-full max-w-md">
        <Suspense
          fallback={
            <div className="rounded-2xl border border-gray-200 bg-white px-7 py-8 text-sm text-black/55 shadow-sm">
              Loading…
            </div>
          }
        >
          <ResetPasswordForm />
        </Suspense>
      </section>
    </main>
  );
}
