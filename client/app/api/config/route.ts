import { NextResponse } from "next/server";

/**
 * Runtime API routing for hybrid direct-API mode.
 * Uses server env (BACKEND_URL, HYBRID_AUTH_ROUTING) so production can enable
 * direct API auth without rebuilding NEXT_PUBLIC_* into the client bundle.
 */
export async function GET() {
  const backendUrl = process.env.BACKEND_URL?.trim().replace(/\/$/, "") || null;
  const publicDirect =
    process.env.NEXT_PUBLIC_DIRECT_API_URL?.trim().replace(/\/$/, "") || null;
  const directApiUrl = backendUrl || publicDirect;

  const hybridAuthRouting =
    process.env.HYBRID_AUTH_ROUTING?.trim() === "1" ||
    process.env.NEXT_PUBLIC_HYBRID_AUTH_ROUTING?.trim() === "1" ||
    /^true$/i.test(process.env.HYBRID_AUTH_ROUTING ?? "") ||
    /^true$/i.test(process.env.NEXT_PUBLIC_HYBRID_AUTH_ROUTING ?? "");

  return NextResponse.json({
    directApiUrl,
    hybridAuthRouting,
  });
}
