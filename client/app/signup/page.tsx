"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 8 &&
    confirmPassword === password;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSuccess(null);

    if (!email || !password || !confirmPassword) {
      setErr("Please fill in all fields.");
      return;
    }
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setErr("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      // backend endpoint: POST /auth/register
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      setSuccess("Account created. You can sign in now.");
      // tiny delay is optional; you can remove it
      setTimeout(() => router.push("/login"), 600);
    } catch (e: any) {
      setErr(e.message || "Signup failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-white px-6">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-black/10 bg-white shadow-[0_16px_40px_rgba(0,0,0,0.08)]">
          <div className="p-8">
            <p className="text-xs tracking-[0.22em] text-black/50">FOCUSFLOW</p>

            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-black">
              Create account
            </h1>
            <p className="mt-1 text-sm text-black/45">
              Keep it simple. Build consistency.
            </p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-black/70">Email</label>
                <input
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-black/30 focus:ring-2 focus:ring-black/10"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm text-black/70">Password</label>
                <input
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-black/30 focus:ring-2 focus:ring-black/10"
                  type="password"
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm text-black/70">Confirm password</label>
                <input
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-black/30 focus:ring-2 focus:ring-black/10"
                  type="password"
                  placeholder="Repeat your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              {err && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {err}
                </p>
              )}

              {success && (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {success}
                </p>
              )}

              <button
                disabled={loading || !canSubmit}
                className="mt-2 w-full rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Creating..." : "Create account"}
              </button>
            </form>

            <div className="mt-5 flex items-center justify-between text-xs text-black/55">
              <span>Already have an account?</span>
              <Link
                href="/login"
                className="font-medium text-black underline underline-offset-4 hover:opacity-80"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-black/40">
          By creating an account you agree to not blame the app for procrastination.
        </p>
      </div>
    </div>
  );
}
