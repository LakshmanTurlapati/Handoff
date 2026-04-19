import { z } from "zod";

export interface ThreadHandoffRecord {
  threadId: string;
  sessionId: string;
  launchUrl: string;
  qrText: string;
  expiresAt: string;
  reused: boolean;
}

export const ThreadHandoffRecordSchema: z.ZodType<ThreadHandoffRecord> = z
  .object({
    threadId: z.string().min(1),
    sessionId: z.string().min(1),
    launchUrl: z.string().url(),
    qrText: z.string().min(1),
    expiresAt: z.string().datetime(),
    reused: z.boolean(),
  })
  .strict();

export interface CodexHandoffResult extends ThreadHandoffRecord {
  daemonAction: "daemon_reused" | "daemon_started";
}

export const CodexHandoffResultSchema: z.ZodType<CodexHandoffResult> = z
  .object({
    threadId: z.string().min(1),
    sessionId: z.string().min(1),
    launchUrl: z.string().url(),
    qrText: z.string().min(1),
    expiresAt: z.string().datetime(),
    reused: z.boolean(),
    daemonAction: z.enum(["daemon_reused", "daemon_started"]),
  })
  .strict();
