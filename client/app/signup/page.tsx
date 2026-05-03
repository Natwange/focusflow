"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

export default function SignupPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSubmit =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    confirmPassword === password;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSuccess(null);

    if (!name.trim() || !email || !password || !confirmPassword) {
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
        body: JSON.stringify({ name: name.trim(), email, password }),
      });

      setSuccess("Account created. Redirecting…");
      setTimeout(() => router.push("/dashboard"), 600);
    } catch (e: any) {
      setErr(e.message || "Signup failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ff-page grid place-items-center px-6">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
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
                <label className="text-sm text-black/70">Name</label>
                <input
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-black/30 focus:ring-2 focus:ring-black/10"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>

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
                <div className="relative">
                  <input
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 pr-11 text-sm outline-none transition focus:border-black/30 focus:ring-2 focus:ring-black/10"
                    type={showPassword ? "text" : "password"}
                    placeholder="Create a password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-black/45 hover:text-black/70 hover:bg-black/5 transition"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-black/70">Confirm password</label>
                <div className="relative">
                  <input
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 pr-11 text-sm outline-none transition focus:border-black/30 focus:ring-2 focus:ring-black/10"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Repeat your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-black/45 hover:text-black/70 hover:bg-black/5 transition"
                    aria-label={showConfirmPassword ? "Hide password" : "Show confirm password"}
                  >
                    <EyeIcon open={showConfirmPassword} />
                  </button>
                </div>
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
