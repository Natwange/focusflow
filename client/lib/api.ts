// Base URL for all API calls, read from client/.env.local
// Local: http://localhost:4000
// Production (two Render hosts / mobile cookie issues): https://<next-host>/api/bff
//   and set server-only BACKEND_URL on the Next service to the real API origin.
// The replace(...) just removes a trailing "/" if there is one,
// so we don't accidentally end up with "http://...//auth/login"
import { redirectToLoginAfterUnauthorized, requestBasePath } from "@/lib/authRedirect";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
let refreshInFlight: Promise<boolean> | null = null;

function shouldAttemptRefresh(path: string, isRetry: boolean): boolean {
  if (isRetry) return false;
  const b = requestBasePath(path);
  return (
    b !== "/auth/login" &&
    b !== "/auth/register" &&
    b !== "/auth/refresh" &&
    b !== "/auth/forgot-password" &&
    b !== "/auth/reset-password" &&
    b !== "/auth/verify-email"
  );
}

async function tryRefreshSession(): Promise<boolean> {
  if (!API_URL) return false;
  const url = `${API_URL}/auth/refresh`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  return res.ok;
}

async function refreshSessionOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = tryRefreshSession()
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function api(path: string, opts: RequestInit = {}): Promise<any> {
  return apiOnce(path, opts, false);
}

async function apiOnce(
  path: string,
  opts: RequestInit,
  isRetry: boolean
): Promise<any> {
  if (!API_URL) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Add it to your .env.local (e.g. NEXT_PUBLIC_API_URL=http://localhost:4000)."
    );
  }

  const url = path.startsWith("/") ? `${API_URL}${path}` : `${API_URL}/${path}`;

  const res = await fetchWithTimeout(url, {
    ...opts,
    credentials: "include",
    headers: {
      ...(opts.headers || {}),
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    let message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Request failed: ${res.status}`;

    if (res.status === 429 && message === "Request failed: 429") {
      message =
        "Too many sign-in attempts. Please wait a minute and try again.";
    }

    if (res.status === 401 && shouldAttemptRefresh(path, isRetry)) {
      const refreshed = await refreshSessionOnce();
      if (refreshed) {
        return apiOnce(path, opts, true);
      }
    }

    if (res.status === 401) {
      redirectToLoginAfterUnauthorized(path);
    }

    throw new Error(message);
  }

  return data;
}
