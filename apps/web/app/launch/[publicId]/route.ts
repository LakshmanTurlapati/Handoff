import { NextResponse } from "next/server";
import { claimHandoffLaunch } from "../../../lib/handoff-launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ publicId: string }>;
}

function resolvePublicOrigin(request: Request): string {
  const forwardedHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!forwardedHost) {
    return new URL(request.url).origin;
  }

  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${forwardedProto}://${forwardedHost}`;
}

function buildPublicUrl(request: Request, pathname: string): URL {
  return new URL(pathname, resolvePublicOrigin(request));
}

function buildLaunchErrorUrl(request: Request, code: string): string {
  const url = buildPublicUrl(request, "/launch/error");
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
      buildPublicUrl(
        request,
        `/session/${encodeURIComponent(result.sessionId)}`,
      ),
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
