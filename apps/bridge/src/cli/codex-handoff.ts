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
  payload?: CodexHandoffResult;
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
    return {
      exitCode: 1,
      message: "missing_active_thread_context",
    };
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
    return {
      exitCode: launchResult.exitCode,
      message: launchResult.message,
    };
  }

  const loadBootstrapState = options.loadBootstrapState ?? loadBridgeBootstrapState;
  const bootstrap = await loadBootstrapState();
  if (!bootstrap) {
    return {
      exitCode: 1,
      message: "missing_bridge_bootstrap_state",
    };
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

  const handoff = await client.createHandoff({
    bridgeInstallationId: bootstrap.bridgeInstallationId,
    bridgeInstanceId: bootstrap.bridgeInstanceId,
    threadId,
    sessionId,
  });

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
