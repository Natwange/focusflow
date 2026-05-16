/** Sign out after this much idle time on authenticated routes. */
export const SESSION_IDLE_MS = 60 * 60 * 1000;

/** Show “still there?” warning this long before idle logout. */
export const SESSION_WARN_MS = 10 * 60 * 1000;

export const SESSION_WARN_AT_MS = SESSION_IDLE_MS - SESSION_WARN_MS;

export const PUBLIC_AUTH_ROUTES = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);

export function isPublicAuthRoute(pathname: string): boolean {
  return PUBLIC_AUTH_ROUTES.has(pathname);
}

export function formatSecondsRemaining(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r} second${r === 1 ? "" : "s"}`;
  if (r === 0) return `${m} minute${m === 1 ? "" : "s"}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}
