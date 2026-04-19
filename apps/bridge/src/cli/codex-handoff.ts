import { Writable } from "node:stream";
import {
  CodexHandoffResultSchema,
  type CodexHandoffResult,
  type ThreadHandoffRecord,
} from "@codex-mobile/protocol";
import {
  PairingClient,
  type CreateHandoffRequest,
} from "../lib/pairing-client.js";
import {
  loadBridgeBootstrapState,
  type BridgeBootstrapState,
} from "../lib/local-state.js";
import {
  runLaunchCommand,
  type LaunchCommandResult,
} from "./launch.js";

export interface CodexHandoffCommandOptions {
  threadId?: string;
  sessionId?: string;
  // Expected CLI invocation: handoff codex-handoff --thread-id <id> --session-id <id> --format json
  format?: string;
  out?: NodeJS.WritableStream;
  launchCommand?: (options?: {
    out?: NodeJS.WritableStream;
  }) => Promise<LaunchCommandResult>;
  loadBootstrapState?: () => Promise<BridgeBootstrapState | null>;
  createPairingClient?: (input: {
    baseUrl: string;
    bridgeBootstrapToken: string;
  }) => {
    createHandoff(request: CreateHandoffRequest): Promise<ThreadHandoffRecord>;
  };
}

export interface CodexHandoffCommandResult {
  exitCode: number;
  message: string;
  guidance?: string;
  payload?: CodexHandoffResult;
}

const HANDOFF_FAILURE_GUIDANCE: Record<string, string> = {
  missing_active_thread_context:
    "Run /handoff from the active Codex thread you want to continue remotely. No session picker fallback.",
  missing_bridge_bootstrap_state:
    "Repair local bridge bootstrap on this machine, then run /handoff again from the same active Codex thread.",
  handoff_expired:
    "The previous handoff expired. Run /handoff again from the same active Codex thread to mint a fresh short-lived handoff.",
  handoff_revoked:
    "The previous handoff was revoked. Re-pair this machine and retry /handoff from the same active Codex thread.",
  handoff_not_authorized:
    "This machine is not authorized for that handoff. Repair bridge pairing on this machine and retry from the same active Codex thread.",
};

function createFailureResult(message: string): CodexHandoffCommandResult {
  return {
    exitCode: 1,
    message,
    guidance: HANDOFF_FAILURE_GUIDANCE[message],
  };
}

function createSilentOutput(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

export async function runCodexHandoffCommand(
  options: CodexHandoffCommandOptions = {},
): Promise<CodexHandoffCommandResult> {
  const threadId = options.threadId?.trim();
  const sessionId = options.sessionId?.trim();

  if (!threadId || !sessionId) {
    return createFailureResult("missing_active_thread_context");
  }

  if (options.format && options.format !== "json") {
    return {
      exitCode: 1,
      message: "unsupported_output_format",
    };
  }

  const launchCommand = options.launchCommand ?? runLaunchCommand;
  const launchResult = await launchCommand({
    out: createSilentOutput(),
  });

  if (launchResult.exitCode !== 0) {
    return launchResult.message in HANDOFF_FAILURE_GUIDANCE
      ? createFailureResult(launchResult.message)
      : {
          exitCode: launchResult.exitCode,
          message: launchResult.message,
        };
  }

  const loadBootstrapState = options.loadBootstrapState ?? loadBridgeBootstrapState;
  const bootstrap = await loadBootstrapState();
  if (!bootstrap) {
    return createFailureResult("missing_bridge_bootstrap_state");
  }

  const client =
    options.createPairingClient?.({
      baseUrl: bootstrap.baseUrl,
      bridgeBootstrapToken: bootstrap.bridgeBootstrapToken,
    }) ??
    new PairingClient({
      baseUrl: bootstrap.baseUrl,
      bridgeBootstrapToken: bootstrap.bridgeBootstrapToken,
    });

  let handoff: ThreadHandoffRecord;
  try {
    handoff = await client.createHandoff({
      bridgeInstallationId: bootstrap.bridgeInstallationId,
      bridgeInstanceId: bootstrap.bridgeInstanceId,
      threadId,
      sessionId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message in HANDOFF_FAILURE_GUIDANCE) {
      return createFailureResult(message);
    }
    throw error;
  }

  const payload = CodexHandoffResultSchema.parse({
    ...handoff,
    daemonAction: launchResult.message,
  });

  (options.out ?? process.stdout).write(`${JSON.stringify(payload)}\n`);

  return {
    exitCode: 0,
    message: "ok",
    payload,
  };
}
