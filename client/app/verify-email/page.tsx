"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { api } from "@/lib/api";

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">(
    token ? "loading" : "err"
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("err");
      setMessage("This page needs a link from your verification email.");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const data = await api("/auth/verify-email", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        if (!cancelled) {
          setStatus("ok");
          setMessage(
            typeof data?.message === "string"
              ? data.message
              : "Email verified. You can close this tab."
          );
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setStatus("err");
          setMessage(
            e instanceof Error
              ? e.message
              : "Verification failed. Try signing in and resend the link from settings."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-7 py-8 shadow-sm">
      <p className="text-xs tracking-[0.22em] text-black/40">FOCUSFLOW</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-black">
        Verify email
      </h1>

      {status === "loading" && (
        <p className="mt-4 text-sm text-black/55">Confirming your address…</p>
      )}

      {status === "ok" && (
        <div className="mt-4 space-y-4">
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </p>
          <Link
            href="/dashboard"
            className="inline-block text-sm font-medium text-black underline underline-offset-4"
          >
            Go to dashboard
          </Link>
        </div>
      )}

      {status === "err" && (
        <div className="mt-4 space-y-4">
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {message}
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href="/login" className="font-medium text-black underline underline-offset-4">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="font-medium text-black underline underline-offset-4"
            >
              Create account
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
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
          <VerifyEmailInner />
        </Suspense>
      </section>
    </main>
  );
}
