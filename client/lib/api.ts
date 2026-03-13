// Base URL for all API calls, read from client/.env.local
// Example: http://localhost:4000
// The replace(...) just removes a trailing "/" if there is one,
// so we don't accidentally end up with "http://...//auth/login"
const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

export async function api(path: string, opts: RequestInit = {}): Promise<any> {
  // Safety check: if the env variable is missing, fail fast with a clear message
  if (!API_URL) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Add it to your .env.local (e.g. NEXT_PUBLIC_API_URL=http://localhost:4000)."
    );
  }

  // Build the full request URL.
  // If caller passes "/auth/login", we join it as "API_URL + /auth/login".
  // If caller forgets the leading "/", we insert it for them.
  const url = path.startsWith("/") ? `${API_URL}${path}` : `${API_URL}/${path}`;

  // Actually send the HTTP request using fetch.
  // We forward any options (method, body, headers) but always enforce JSON content type.
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      "Content-Type": "application/json",
    },
  });

  // Read the response body as text first so we can safely try to parse JSON.
  const text = await res.text();
  let data: any = null; // this will hold either parsed JSON or raw text

  // Try to parse JSON; if parsing fails, we just keep the raw string in `data`.
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    // If the server sent back a JSON object like { error: "Something" }
    // we surface that message. Otherwise we fall back to "Request failed: <status>".
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Request failed: ${res.status}`;
    throw new Error(message);
  }

  // For successful responses, give the parsed data back to the caller.
  return data;
}
