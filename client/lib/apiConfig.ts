import { requestBasePath } from "@/lib/authRedirect";

/** BFF or single-origin API base (NEXT_PUBLIC_API_URL). Used when hybrid mode is off. */
export function getAppApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
}

/** Direct Express API origin from build-time env (NEXT_PUBLIC_DIRECT_API_URL). */
export function getDirectApiBaseFromEnv(): string | null {
  const raw = process.env.NEXT_PUBLIC_DIRECT_API_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

export type ApiRoutingConfig = {
  hybridAuthRouting: boolean;
  directApiBase: string | null;
  appApiBase: string;
};

let cachedRouting: ApiRoutingConfig | null = null;
let routingLoadPromise: Promise<ApiRoutingConfig> | null = null;

function isHybridFlagEnabled(flag: string | undefined): boolean {
  const trimmed = flag?.trim();
  if (!trimmed) return false;
  if (trimmed === "0" || /^false$/i.test(trimmed)) return false;
  return trimmed === "1" || /^true$/i.test(trimmed);
}

function buildRoutingFromEnv(): ApiRoutingConfig {
  const appApiBase = getAppApiBase();
  const directApiBase = getDirectApiBaseFromEnv();
  const hybridAuthRouting = Boolean(
    isHybridFlagEnabled(process.env.NEXT_PUBLIC_HYBRID_AUTH_ROUTING) &&
      directApiBase &&
      appApiBase &&
      directApiBase !== appApiBase
  );

  return {
    hybridAuthRouting,
    directApiBase: hybridAuthRouting ? directApiBase : null,
    appApiBase,
  };
}

async function loadRoutingConfig(): Promise<ApiRoutingConfig> {
  if (typeof window === "undefined") {
    return buildRoutingFromEnv();
  }

  try {
    const res = await fetch("/api/config", { credentials: "same-origin" });
    if (!res.ok) return buildRoutingFromEnv();

    const data = (await res.json()) as {
      directApiUrl?: string | null;
      hybridAuthRouting?: boolean;
    };

    const appApiBase = getAppApiBase();
    const directApiBase =
      data.directApiUrl?.trim().replace(/\/$/, "") ||
      getDirectApiBaseFromEnv();
    const hybridAuthRouting = Boolean(
      data.hybridAuthRouting &&
        directApiBase &&
        appApiBase &&
        directApiBase !== appApiBase
    );

    return {
      hybridAuthRouting,
      directApiBase: hybridAuthRouting ? directApiBase : null,
      appApiBase,
    };
  } catch {
    return buildRoutingFromEnv();
  }
}

/** Load routing once per page session (runtime BACKEND_URL + HYBRID_AUTH_ROUTING). */
export async function ensureApiRoutingConfig(): Promise<ApiRoutingConfig> {
  if (cachedRouting) return cachedRouting;
  if (!routingLoadPromise) {
    routingLoadPromise = loadRoutingConfig().then((config) => {
      cachedRouting = config;
      return config;
    });
  }
  return routingLoadPromise;
}

export function getCachedApiRoutingConfig(): ApiRoutingConfig | null {
  return cachedRouting;
}

/** @deprecated use ensureApiRoutingConfig — kept for sync callers after preload */
export function getDirectApiBase(): string | null {
  return cachedRouting?.directApiBase ?? getDirectApiBaseFromEnv();
}

export function isHybridAuthRoutingEnabled(): boolean {
  if (cachedRouting) return cachedRouting.hybridAuthRouting;
  return buildRoutingFromEnv().hybridAuthRouting;
}

/** Effective API origin — direct API host when hybrid mode is on. */
export function resolveRequestBase(_apiPath?: string): string {
  const routing = cachedRouting ?? buildRoutingFromEnv();
  if (routing.hybridAuthRouting && routing.directApiBase) {
    return routing.directApiBase;
  }
  return routing.appApiBase || getAppApiBase();
}

export const LOGIN_TRANSIENT_HTTP_STATUSES = [429, 502, 503, 504] as const;

export function isLoginTransientHttpStatus(status: number): boolean {
  return (LOGIN_TRANSIENT_HTTP_STATUSES as readonly number[]).includes(status);
}

export function isLoginPath(apiPath: string): boolean {
  return requestBasePath(apiPath) === "/auth/login";
}

export function isAuthApiPath(apiPath: string): boolean {
  const base = requestBasePath(apiPath);
  if (base.startsWith("/auth/")) return true;
  if (base === "/me" || base.startsWith("/me/")) return true;
  if (base.startsWith("/integrations/")) return true;
  return false;
}

export function logHybridExperiment(
  event: "request_start" | "response" | "login_retry" | "health_check" | "routing_config",
  details: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;

  const routing = cachedRouting ?? buildRoutingFromEnv();
  if (!routing.hybridAuthRouting && event !== "routing_config") return;

  console.info(`[FocusFlow hybrid-direct] ${event}`, {
    ...details,
    routing: routing.hybridAuthRouting ? "direct-api" : "bff",
    directBase: routing.directApiBase,
    appBase: routing.appApiBase,
    bffBypassed: routing.hybridAuthRouting,
    at: new Date().toISOString(),
  });
}
