import { requestBasePath } from "@/lib/authRedirect";

/** BFF or single-origin API base (NEXT_PUBLIC_API_URL). Used when hybrid mode is off. */
export function getAppApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
}

/** Direct Express API origin (NEXT_PUBLIC_DIRECT_API_URL). */
export function getDirectApiBase(): string | null {
  const raw = process.env.NEXT_PUBLIC_DIRECT_API_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

/**
 * Hybrid direct-API experiment: bypass BFF entirely; all api() calls use DIRECT_API_URL.
 * Opt-in via NEXT_PUBLIC_HYBRID_AUTH_ROUTING=1 and NEXT_PUBLIC_DIRECT_API_URL.
 */
export function isHybridAuthRoutingEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_HYBRID_AUTH_ROUTING?.trim();
  if (flag === "0" || /^false$/i.test(flag ?? "")) return false;
  if (flag !== "1" && !/^true$/i.test(flag ?? "")) return false;

  const appBase = getAppApiBase();
  const directBase = getDirectApiBase();
  if (!appBase || !directBase) return false;
  return appBase !== directBase;
}

/** Effective API origin for the current routing mode. */
export function resolveRequestBase(_apiPath?: string): string {
  const appBase = getAppApiBase();
  if (!appBase) return "";

  if (isHybridAuthRoutingEnabled()) {
    return getDirectApiBase() ?? appBase;
  }
  return appBase;
}

export const LOGIN_TRANSIENT_HTTP_STATUSES = [429, 502, 503, 504] as const;

export function isLoginTransientHttpStatus(status: number): boolean {
  return (LOGIN_TRANSIENT_HTTP_STATUSES as readonly number[]).includes(status);
}

export function isLoginPath(apiPath: string): boolean {
  return requestBasePath(apiPath) === "/auth/login";
}

export function logHybridExperiment(
  event: "request_start" | "response" | "login_retry" | "health_check",
  details: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  if (!isHybridAuthRoutingEnabled()) return;

  console.info(`[FocusFlow hybrid-direct] ${event}`, {
    ...details,
    routing: "direct-api",
    directBase: getDirectApiBase(),
    bffBypassed: true,
    at: new Date().toISOString(),
  });
}
