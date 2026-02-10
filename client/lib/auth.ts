const KEY = "focusflow_token";

function isBrowser() {
  return typeof window !== "undefined";
}

export function setToken(token: string) {
  if (!isBrowser()) return;
  localStorage.setItem(KEY, token);
}

export function getToken() {
  if (!isBrowser()) return null;
  return localStorage.getItem(KEY);
}

export function clearToken() {
  if (!isBrowser()) return;
  localStorage.removeItem(KEY);
}
