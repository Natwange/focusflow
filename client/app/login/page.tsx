"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { setToken } from "@/lib/auth";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    // eye-off
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
    // eye
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

export default function LoginPage() {
  const router = useRouter();

  // keep your defaults for testing
  const [email, setEmail] = useState("test1@example.com");
  const [password, setPassword] = useState("Password123!");
  const [showPw, setShowPw] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit =
    email.trim().length > 0 && password.trim().length >= 8;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.trim().length < 8) {
      setErr("Password must be at least 8 characters");
      return;
    }
    setLoading(true);

    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      // backend returns: { token }
      setToken(data.token);
      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-white px-6">
      {/* subtle, minimal background */}
      <div className="absolute inset-0 -z-10 bg-[#f6f8fb]" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(143,171,212,0.25),transparent_55%)]" />

      <section className="w-full max-w-md">
      <div className="rounded-2xl border border-black/10 bg-white px-7 py-8 shadow-[0_16px_40px_rgba(0,0,0,0.08)]">
          <p className="text-xs tracking-[0.22em] text-black/40">
            FOCUSFLOW
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-black">
            Sign in
          </h1>
          <p className="mt-1 text-sm text-black/55">
            Stay consistent. Finish what you start.
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            {/* Email */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-black/60">Email</label>
              <input
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/30 outline-none transition focus:border-black/25 focus:ring-4 focus:ring-[#8FABD4]/25"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-black/60">Password</label>

              <div className="relative">
                <input
                  className="w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 pr-11 text-sm text-black placeholder:text-black/30 outline-none transition focus:border-black/25 focus:ring-4 focus:ring-[#8FABD4]/25"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />

                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-black/45 hover:text-black/70 hover:bg-black/5 transition"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  <EyeIcon open={showPw} />
                </button>
              </div>
              {password.length > 0 && password.length < 8 && (
                <p className="text-xs text-amber-700">
                  Password must be at least 8 characters
                </p>
              )}
            </div>

            {/* Error */}
            {err && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {err}
              </div>
            )}

            {/* Button */}
            <button
              disabled={loading || !canSubmit}
              className="mt-2 w-full rounded-lg bg-black py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-black/90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Logging in..." : "Log in"}
            </button>

            {/* Footer links */}
            <div className="flex items-center justify-between pt-1 text-xs text-black/55">
              <button
                type="button"
                className="underline underline-offset-4 hover:text-black"
                onClick={() => alert("Not built yet.")}
              >
                Forgot password?
              </button>

              <button
                type="button"
                className="hover:text-black"
                onClick={() => alert("Not built yet.")}
              >
                First time? Create account
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
