export function requestBasePath(apiPath: string): string {
  const raw = apiPath.split("?")[0] ?? "";
  return raw.startsWith("/") ? raw : `/${raw}`;
}


/**
 * When the API returns 401 for a missing/expired session, send the user to the app login.
 * Skips: server (no window), login/signup pages, and /auth/login (wrong password is also 401).
 */
export function redirectToLoginAfterUnauthorized(apiPath: string): void {
  if (typeof window === "undefined") return;

  const base = requestBasePath(apiPath);
  if (base === "/auth/login" || base === "/auth/register") return;

  const p = window.location.pathname.replace(/\/+$/, "") || "/";
  // Landing + auth flows: `/me` may 401; do not hijack the user away from these routes.
  if (
    p === "/" ||
    p === "/login" ||
    p === "/signup" ||
    p === "/forgot-password" ||
    p === "/reset-password" ||
    p === "/verify-email"
  ) {
    return;
  }

  window.location.assign("/login");
}
