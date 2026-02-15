const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

export async function api(path: string, opts: RequestInit = {}): Promise<any> {
  if (!API_URL) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Add it to your .env.local (e.g. NEXT_PUBLIC_API_URL=http://localhost:4000)."
    );
  }

  const url = path.startsWith("/") ? `${API_URL}${path}` : `${API_URL}/${path}`;
  const res = await fetch(url, {
    ...opts,
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
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return data;
}
