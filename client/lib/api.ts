// Base URL for all API calls, read from client/.env.local
// Local: http://localhost:4000
// Production (two Render hosts / mobile cookie issues): https://<next-host>/api/bff
//   and set server-only BACKEND_URL on the Next service to the real API origin.
//
// Hybrid direct-API experiment (production):
//   NEXT_PUBLIC_HYBRID_AUTH_ROUTING=1
//   NEXT_PUBLIC_DIRECT_API_URL=https://<api-host>
// While enabled, every api() call bypasses the BFF and hits the Express API directly.
import { redirectToLoginAfterUnauthorized, requestBasePath } from "@/lib/authRedirect";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import {
  ensureApiRoutingConfig,
  getAppApiBase,
  getDirectApiBase,
  isHybridAuthRoutingEnabled,
  isLoginPath,
  isLoginTransientHttpStatus,
  logHybridExperiment,
  resolveRequestBase,
} from "@/lib/apiConfig";

let refreshInFlight: Promise<boolean> | null = null;
let loginHealthWarmInFlight: Promise<void> | null = null;

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

async function warmDirectApiHealth(): Promise<number | null> {
  const directBase = getDirectApiBase();
  if (!directBase) return null;

  try {
    const res = await fetchWithTimeout(
      `${directBase}/health`,
      { credentials: "include" },
      8_000
    );
    logHybridExperiment("health_check", {
      status: res.status,
      url: `${directBase}/health`,
    });
    return res.status;
  } catch (err) {
    logHybridExperiment("health_check", {
      status: null,
      error: err instanceof Error ? err.message : String(err),
      url: `${directBase}/health`,
    });
    return null;
  }
}

async function warmDirectApiBeforeLogin(): Promise<void> {
  if (!isHybridAuthRoutingEnabled()) return;
  if (!loginHealthWarmInFlight) {
    loginHealthWarmInFlight = warmDirectApiHealth()
      .then(() => undefined)
      .finally(() => {
        loginHealthWarmInFlight = null;
      });
  }
  await loginHealthWarmInFlight;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryRefreshSession(): Promise<boolean> {
  const refreshBase = resolveRequestBase("/auth/refresh");
  const url = `${refreshBase}/auth/refresh`;

  logHybridExperiment("request_start", {
    path: "/auth/refresh",
    method: "POST",
    base: refreshBase,
  });

  const res = await fetchWithTimeout(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  logHybridExperiment("response", {
    path: "/auth/refresh",
    status: res.status,
    base: refreshBase,
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
  return apiOnce(path, opts, false, false);
}

async function apiOnce(
  path: string,
  opts: RequestInit,
  isUnauthorizedRetry: boolean,
  isLoginTransientRetry: boolean
): Promise<any> {
  await ensureApiRoutingConfig();

  const appBase = getAppApiBase();
  if (!appBase) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Add it to your .env.local (e.g. NEXT_PUBLIC_API_URL=http://localhost:4000)."
    );
  }

  const base = requestBasePath(path);
  if (isLoginPath(path) && isHybridAuthRoutingEnabled() && !isLoginTransientRetry) {
    await warmDirectApiBeforeLogin();
  }

  const requestBase = resolveRequestBase(path);
  const url = path.startsWith("/") ? `${requestBase}${path}` : `${requestBase}/${path}`;
  const method = (opts.method ?? "GET").toString().toUpperCase();

  if (isLoginPath(path)) {
    logHybridExperiment("routing_config", {
      path: base,
      loginUrl: url,
      hybrid: isHybridAuthRoutingEnabled(),
      viaBff: url.includes("/api/bff"),
    });
  }

  logHybridExperiment("request_start", {
    path: base,
    method,
    base: requestBase,
    loginTransientRetry: isLoginTransientRetry,
  });

  const res = await fetchWithTimeout(url, {
    ...opts,
    credentials: "include",
    headers: {
      ...(opts.headers || {}),
      "Content-Type": "application/json",
    },
  });

  logHybridExperiment("response", {
    path: base,
    status: res.status,
    base: requestBase,
    loginTransientRetry: isLoginTransientRetry,
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    if (
      isLoginPath(path) &&
      isHybridAuthRoutingEnabled() &&
      !isLoginTransientRetry &&
      isLoginTransientHttpStatus(res.status)
    ) {
      logHybridExperiment("login_retry", {
        path: base,
        status: res.status,
        delayMs: 3000,
        base: requestBase,
      });
      await sleep(3000);
      return apiOnce(path, opts, isUnauthorizedRetry, true);
    }

    let message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Request failed: ${res.status}`;

    if (res.status === 429 && message === "Request failed: 429") {
      if (base === "/auth/register") {
        message =
          "Too many sign-up attempts. Please wait a few minutes and try again.";
      } else if (base === "/auth/forgot-password") {
        message =
          "Too many password reset requests. Please wait and try again.";
      } else if (base === "/auth/login") {
        message =
          "Too many sign-in attempts. Please wait a few minutes and try again.";
      } else {
        message =
          "Too many attempts. Please wait a few minutes and try again.";
      }
    }

    if (res.status === 401 && shouldAttemptRefresh(path, isUnauthorizedRetry)) {
      const refreshed = await refreshSessionOnce();
      if (refreshed) {
        return apiOnce(path, opts, true, isLoginTransientRetry);
      }
    }

    if (res.status === 401) {
      redirectToLoginAfterUnauthorized(path);
    }

    throw new Error(message);
  }

  return data;
}

export {
  ensureApiRoutingConfig,
  getAppApiBase,
  getDirectApiBase,
  isHybridAuthRoutingEnabled,
  resolveRequestBase,
} from "@/lib/apiConfig";
