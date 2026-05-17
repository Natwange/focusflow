const DEFAULT_TIMEOUT_MS = 25_000;

export class RequestTimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

/** fetch with an upper bound so a sleeping API cannot block the UI for minutes. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  const onUserAbort = () => controller.abort();
  if (init.signal) {
    if (init.signal.aborted) {
      window.clearTimeout(timeoutId);
      controller.abort();
    } else {
      init.signal.addEventListener("abort", onUserAbort, { once: true });
    }
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (init.signal?.aborted) throw err;
      throw new RequestTimeoutError(
        "Request timed out. The server may be waking up — try again in a moment."
      );
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
    if (init.signal) {
      init.signal.removeEventListener("abort", onUserAbort);
    }
  }
}

export const API_REQUEST_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
