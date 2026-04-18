import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { SessionShell } from "./session-shell";

interface SessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function SessionPage({ params }: SessionPageProps) {
  const { sessionId } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect(`/sign-in?callbackUrl=/session/${sessionId}`);
  }

  return (
    <SessionShell sessionId={sessionId} initialConnection="connecting" />
  );
}
