import { NextRequest, NextResponse } from "next/server";

/**
 * Same-origin API proxy for production: browser calls /api/bff/* on the Next host,
 * this route forwards to the real Express API (BACKEND_URL).
 *
 * Fixes mobile browsers blocking third-party cookies when the SPA and API are on
 * different hosts (e.g. two *.onrender.com URLs). Cookies are re-emitted for the
 * Next host (first-party) with SameSite=Lax.
 *
 * Local dev: keep NEXT_PUBLIC_API_URL=http://localhost:4000 and do not use this route.
 *
 * Production (Render client service):
 * - NEXT_PUBLIC_API_URL=https://<your-next-host>/api/bff
 * - BACKEND_URL=https://<your-api-host>   (server-only, no trailing slash)
 */
function backendBase(): string | null {
  const raw = process.env.BACKEND_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

/** Best-effort client IP for upstream rate limiting (Render/Vercel/CDN headers). */
function resolveClientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    // Use the left-most public-looking IP (original client behind proxies).
    for (const part of parts) {
      if (part && part !== "unknown") return part;
    }
  }

  const candidates = [
    req.headers.get("x-real-ip"),
    req.headers.get("cf-connecting-ip"),
    req.headers.get("true-client-ip"),
    req.headers.get("x-vercel-forwarded-for"),
    req.headers.get("fly-client-ip"),
    req.headers.get("x-client-ip"),
  ];

  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed && trimmed !== "unknown") return trimmed;
  }

  const forwarded = req.headers.get("forwarded");
  if (forwarded) {
    const match = forwarded.match(/for=(?:"\[?([^"\];,\s]+)\]?"|([^";,\s]+))/i);
    const ip = match?.[1] || match?.[2];
    if (ip?.trim()) return ip.trim();
  }

  return null;
}

/** Strip Domain / Partitioned; use Lax so cookies work first-party on the Next host. */
function rewriteSetCookieForBff(header: string): string {
  let h = header.replace(/;\s*Domain=[^;]*/gi, "");
  h = h.replace(/;\s*Partitioned\b/gi, "");
  h = h.replace(/;\s*SameSite=None\b/gi, "; SameSite=Lax");
  return h;
}

/**
 * Runtime-safe Set-Cookie extraction.
 * Some runtimes expose headers.getSetCookie(), others only expose a single combined header.
 */
function extractSetCookieLines(headers: Headers): string[] {
  const native = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof native === "function") {
    return native.call(headers);
  }

  const combined = headers.get("set-cookie");
  if (!combined) return [];

  // Split on cookie boundaries (comma followed by next cookie key=...).
  // This avoids splitting the Expires attribute, which contains a comma.
  return combined.split(/,(?=\s*[^=;,\s]+=[^;]*)/g).map((v) => v.trim()).filter(Boolean);
}

async function proxy(req: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const backend = backendBase();
  if (!backend) {
    return NextResponse.json(
      { error: "Server misconfiguration: BACKEND_URL is not set." },
      { status: 500 }
    );
  }

  const path = pathSegments.length ? pathSegments.join("/") : "";
  if (!path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const targetUrl = `${backend}/${path}${req.nextUrl.search}`;

  const headers = new Headers();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);

  // Forward the real browser IP so API rate limits never collapse to the BFF host.
  const clientIp = resolveClientIp(req);
  if (clientIp) {
    headers.set("x-focusflow-client-ip", clientIp);
    headers.set("x-forwarded-for", clientIp);
    headers.set("x-real-ip", clientIp);
  }

  const method = req.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);
  const init: RequestInit = {
    method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
  };

  const upstream = await fetch(targetUrl, init);
  let body: BodyInit = await upstream.arrayBuffer();
  const status = upstream.status;
  let outCt = upstream.headers.get("content-type") ?? "";

  // Plain-text upstream errors are hard to parse in the SPA — normalize to JSON.
  if (status >= 400 && !outCt.includes("application/json")) {
    const text = new TextDecoder().decode(body).trim();
    const errorMessage =
      status === 429 &&
      (!text || /^too many requests$/i.test(text))
        ? "Too many requests. Please wait a few minutes and try again."
        : text || `Request failed (HTTP ${status})`;
    body = new TextEncoder().encode(
      JSON.stringify({
        error: errorMessage,
        upstreamStatus: status,
        upstreamHost: new URL(backend).host,
      })
    );
    outCt = "application/json";
  }

  const res = new NextResponse(body, { status });

  if (outCt) res.headers.set("content-type", outCt);

  const setCookies = extractSetCookieLines(upstream.headers);

  for (const line of setCookies) {
    res.headers.append("Set-Cookie", rewriteSetCookieForBff(line));
  }

  return res;
}

type RouteCtx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}
