/**
 * Terminal QR rendering for the Codex Mobile bridge CLI.
 *
 * Why this file exists:
 *   The bridge prints a QR code in the terminal so the developer can
 *   scan it with their phone and open the hosted pairing URL. The plan
 *   acceptance criteria requires the exact export name `renderTerminalQr`
 *   so downstream tooling can spy on the call, and we deliberately avoid
 *   importing any Node-only browser-style QR libraries — the `qrcode`
 *   package ships a pure-Node terminal renderer via `toString`.
 *
 * Design rules:
 *   - Render as small as possible while staying scannable. The `small`
 *     rendering option uses half-block characters and works on every
 *     modern terminal emulator tested in Phase 1.
 *   - Never throw on rendering failure. If the QR cannot be rendered
 *     (for example because the terminal width is too narrow), fall back
 *     to an explicit textual instruction so the fallback `userCode`
 *     still gets the developer past the QR step.
 */
import QRCode from "qrcode";

/** Options accepted by {@link renderTerminalQr}. */
export interface RenderTerminalQrOptions {
  /** Error correction level. Defaults to "M" which matches phone scanners. */
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  /** Use the small half-block renderer. Defaults to true. */
  small?: boolean;
}

/**
 * Render a pairing URL as an ASCII QR code suitable for printing in a
 * terminal. Always returns a string; never throws — on failure it
 * returns a human-readable instruction so the bridge CLI can continue
 * showing the fallback `userCode` path.
 */
export async function renderTerminalQr(
  data: string,
  options: RenderTerminalQrOptions = {},
): Promise<string> {
  try {
    return await QRCode.toString(data, {
      type: "terminal",
      small: options.small ?? true,
      errorCorrectionLevel: options.errorCorrectionLevel ?? "M",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    return [
      "  (QR render unavailable: " + reason + ")",
      "  Open this URL on your phone instead:",
      "    " + data,
      "",
    ].join("\n");
  }
}
