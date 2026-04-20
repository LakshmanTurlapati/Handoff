import { NextResponse } from "next/server";
import { claimHandoffLaunch } from "../../../lib/handoff-launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ publicId: string }>;
}

function buildLaunchErrorUrl(request: Request, code: string): string {
  const url = new URL("/launch/error", request.url);
  url.searchParams.set("code", code);
  return url.toString();
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { publicId } = await context.params;
  if (!publicId) {
    return NextResponse.redirect(buildLaunchErrorUrl(request, "handoff_not_found"));
  }

  try {
    const result = await claimHandoffLaunch({
      publicId,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.redirect(
      new URL(`/session/${encodeURIComponent(result.sessionId)}`, request.url),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "handoff_not_found";
    const code =
      message === "handoff_expired" ||
      message === "handoff_revoked" ||
      message === "handoff_not_authorized" ||
      message === "handoff_not_found"
        ? message
        : "handoff_not_found";

    return NextResponse.redirect(buildLaunchErrorUrl(request, code));
  }
}
