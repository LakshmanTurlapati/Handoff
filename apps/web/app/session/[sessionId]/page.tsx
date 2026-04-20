import { redirect } from "next/navigation";
import { requireRemotePrincipal } from "../../../lib/live-session/server";
import { SessionShell } from "./session-shell";

interface SessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function SessionPage({ params }: SessionPageProps) {
  const { sessionId } = await params;
  try {
    await requireRemotePrincipal();
  } catch {
    redirect("/");
  }

  return (
    <SessionShell sessionId={sessionId} initialConnection="connecting" />
  );
}
