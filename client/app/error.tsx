"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full rounded-2xl border border-black/10 bg-white p-8 shadow-sm text-center">
        <h1 className="text-xl font-semibold text-black">Something went wrong</h1>
        <p className="mt-2 text-sm text-black/60">
          The page hit an error. Try reloading or go back to the dashboard.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl bg-black text-white px-4 py-2.5 text-sm font-medium hover:bg-black/90"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="rounded-xl border border-black/20 px-4 py-2.5 text-sm font-medium hover:bg-black/5"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
