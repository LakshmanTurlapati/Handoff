import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installCodexHandoffCommand,
  resolveCodexCommandDir,
} from "../../src/lib/codex-command-install.js";

describe("codex command install", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(os.tmpdir(), "handoff-codex-command-"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("installs handoff.md into ${CODEX_HOME}/commands", async () => {
    const codexHome = join(tempRoot, "codex-home");
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubEnv("HOME", join(tempRoot, "unused-home"));

    const status = await installCodexHandoffCommand();
    const commandDir = resolveCodexCommandDir();
    const installed = await readFile(join(commandDir, "handoff.md"), "utf8");

    expect(status).toBe("command_installed");
    expect(commandDir).toBe(join(codexHome, "commands"));
    expect(installed).toContain(
      "Start or reuse a thread-bound handoff from the current Codex session.",
    );
  });

  it("falls back to ${HOME}/.codex/commands when CODEX_HOME is unset", async () => {
    const home = join(tempRoot, "home");
    vi.stubEnv("CODEX_HOME", "");
    vi.stubEnv("HOME", home);

    const status = await installCodexHandoffCommand();
    const commandDir = resolveCodexCommandDir();
    const installed = await readFile(join(commandDir, "handoff.md"), "utf8");

    expect(status).toBe("command_installed");
    expect(commandDir).toBe(join(home, ".codex/commands"));
    expect(installed).toContain("handoff codex-handoff --format json");
  });

  it("skips an idempotent re-run without creating duplicates", async () => {
    const codexHome = join(tempRoot, "codex-home");
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubEnv("HOME", join(tempRoot, "unused-home"));

    const firstStatus = await installCodexHandoffCommand();
    const secondStatus = await installCodexHandoffCommand();
    const commandDir = resolveCodexCommandDir();
    const commandFiles = await readdir(commandDir);

    expect(firstStatus).toBe("command_installed");
    expect(secondStatus).toBe("command_install_skipped");
    expect(commandFiles.filter((file) => file === "handoff.md")).toHaveLength(1);
  });

  it("updates an existing handoff.md when the installed contents drift", async () => {
    const codexHome = join(tempRoot, "codex-home");
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubEnv("HOME", join(tempRoot, "unused-home"));

    await installCodexHandoffCommand();
    const commandPath = join(resolveCodexCommandDir(), "handoff.md");
    await writeFile(commandPath, "# stale command\n", "utf8");

    const status = await installCodexHandoffCommand();
    const installed = await readFile(commandPath, "utf8");

    expect(status).toBe("command_updated");
    expect(installed).toContain("missing_active_thread_context");
  });
});
