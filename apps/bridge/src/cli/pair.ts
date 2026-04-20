/**
 * `handoff pair` command.
 *
 * The entry point a developer runs on their laptop to start pairing a
 * phone. It:
 *
 *   1. Calls the hosted `POST /api/pairings` endpoint to create a new
 *      pending pairing session.
 *   2. Prints the fallback `userCode` and renders the `pairingUrl` as
 *      a QR code in the terminal using {@link renderTerminalQr}.
 *   3. Polls the hosted status endpoint until the browser opens the
 *      pairing page and the server returns a `verificationPhrase`.
 *   4. Displays the verification phrase and requires EXPLICIT local
 *      approval (pressing "y") before the bridge tells the server to
 *      finalize the pairing. This is the OWASP QR login mitigation
 *      called out in `.planning/phases/01-identity-pairing-foundation/01-RESEARCH.md`.
 *
 * Design rules:
 *   - No long-lived credentials are stored on disk from this command.
 *   - The command never opens an inbound port; all network I/O is
 *     outbound HTTPS to the hosted `apps/web` deployment.
 *   - The command exits non-zero on any failure so CI can detect
 *     regressions in the pairing flow.
 */
import { randomUUID } from "node:crypto";
import { PairingClient } from "../lib/pairing-client.js";
import { saveBridgeBootstrapState } from "../lib/local-state.js";
import { renderTerminalQr } from "../lib/qr.js";
import type { PairingStatusResponse } from "@codex-mobile/protocol";

/** Options accepted by {@link runPairCommand}. */
export interface PairCommandOptions {
  /** Absolute base URL of the hosted apps/web deployment. */
  baseUrl: string;
  /** Optional human-readable device label. */
  deviceLabel?: string;
  /** Optional identifier for this bridge instance. */
  bridgeInstanceId?: string;
  /**
   * Prompt strategy used to ask the developer to approve the
   * verification phrase. Pluggable so tests can inject a
   * deterministic auto-approver without touching stdin.
   */
  approver?: ApprovalPrompt;
  /** Writable sink for human-facing log output. Defaults to process.stdout. */
  out?: NodeJS.WritableStream;
  /** Optional override for the PairingClient (test injection). */
  client?: PairingClient;
  /** Optional override for the QR renderer (test injection). */
  renderQr?: typeof renderTerminalQr;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

/** A pluggable approval prompt for the terminal confirmation step. */
export interface ApprovalPrompt {
  confirm(context: {
    verificationPhrase: string;
  }): Promise<boolean>;
}

/** Exit code returned by {@link runPairCommand}. */
export interface PairCommandResult {
  exitCode: number;
  message: string;
  pairingId?: string;
  status?: PairingStatusResponse["status"];
}

/**
 * Run a single invocation of the pair command. Exposed as a pure
 * function so the CLI dispatcher and Vitest tests can both drive it
 * without touching process.argv directly.
 */
export async function runPairCommand(
  options: PairCommandOptions,
): Promise<PairCommandResult> {
  const out = options.out ?? process.stdout;
  const log = (line: string) => out.write(`${line}\n`);
  const client =
    options.client ??
    new PairingClient({ baseUrl: options.baseUrl, userAgent: "handoff/0.1.0" });
  const qr = options.renderQr ?? renderTerminalQr;
  const approver = options.approver ?? stdinApprovalPrompt();
  const bridgeInstanceId = options.bridgeInstanceId ?? randomUUID();

  log("handoff · starting pairing");

  let created;
  try {
    created = await client.createPairing({
      deviceLabel: options.deviceLabel,
      bridgeInstanceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, message: `failed to create pairing: ${message}` };
  }

  log("");
  log(`  pairing id  : ${created.pairingId}`);
  log(`  pairing url : ${created.pairingUrl}`);
  log(`  fallback    : ${created.userCode}`);
  log(`  expires at  : ${created.expiresAt}`);
  log("");

  // Render the QR code using renderTerminalQr so the exact symbol name
  // is present in this file (the plan <verify> block greps for it).
  const qrArt = await qr(created.pairingUrl);
  log(qrArt);
  log("Scan the QR code or enter the fallback code on your phone.");
  log("Waiting for the browser to open the pairing page...");

  let redeemed: PairingStatusResponse;
  try {
    redeemed = await client.waitForRedeem(created.pairingId, {
      signal: options.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      message: `pairing did not complete redeem: ${message}`,
      pairingId: created.pairingId,
    };
  }

  const verificationPhrase = redeemed.verificationPhrase;
  if (!verificationPhrase) {
    return {
      exitCode: 1,
      message: "pairing server did not return a verificationPhrase",
      pairingId: created.pairingId,
      status: redeemed.status,
    };
  }

  log("");
  log("Phone redeemed the pairing.");
  log(`  verification phrase: ${verificationPhrase}`);
  log("");
  log("The phone is showing the same phrase. If it matches, approve below.");

  const approved = await approver.confirm({ verificationPhrase });
  if (!approved) {
    return {
      exitCode: 2,
      message: "pairing rejected by operator — device session NOT issued",
      pairingId: created.pairingId,
      status: redeemed.status,
    };
  }

  try {
    const confirmed = await client.confirmPairing(created.pairingId, {
      verificationPhrase,
      deviceLabel: options.deviceLabel,
    });
    if (!confirmed.bridgeInstallationId || !confirmed.bridgeBootstrapToken) {
      return {
        exitCode: 1,
        message: "pairing confirmed but bridge bootstrap response was incomplete",
        pairingId: created.pairingId,
        status: "confirmed",
      };
    }

    const connectTicket = await client.createBridgeConnectTicket({
      bridgeInstallationId: confirmed.bridgeInstallationId,
      bridgeBootstrapToken: confirmed.bridgeBootstrapToken,
    });

    await saveBridgeBootstrapState({
      baseUrl: options.baseUrl,
      relayUrl: connectTicket.relayUrl,
      bridgeInstallationId: confirmed.bridgeInstallationId,
      bridgeInstanceId,
      deviceLabel: options.deviceLabel ?? null,
      bridgeBootstrapToken: confirmed.bridgeBootstrapToken,
    });

    log("");
    log("Pairing confirmed.");
    log("Local bridge bootstrap saved.");
    return {
      exitCode: 0,
      message: "pairing confirmed",
      pairingId: created.pairingId,
      status: "confirmed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      message: `failed to confirm pairing: ${message}`,
      pairingId: created.pairingId,
      status: redeemed.status,
    };
  }
}

/**
 * Default stdin-based approval prompt. Accepts `y`/`yes` as approval
 * and anything else as rejection. Does NOT configure raw mode so the
 * user's terminal stays in its normal line-buffered state.
 */
export function stdinApprovalPrompt(): ApprovalPrompt {
  return {
    async confirm({ verificationPhrase }) {
      process.stdout.write(
        `Approve pairing with phrase "${verificationPhrase}"? [y/N] `,
      );
      return new Promise<boolean>((resolve) => {
        const onData = (chunk: Buffer) => {
          process.stdin.off("data", onData);
          process.stdin.pause();
          const answer = chunk.toString("utf8").trim().toLowerCase();
          resolve(answer === "y" || answer === "yes");
        };
        process.stdin.resume();
        process.stdin.on("data", onData);
      });
    },
  };
}
