import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installCodexHandoffCommand,
  resolveCodexCommandDir,
  resolveCodexCommandInstallDirs,
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

  it("installs handoff.md into ${CODEX_HOME}/prompts and ${CODEX_HOME}/commands", async () => {
    const codexHome = join(tempRoot, "codex-home");
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubEnv("HOME", join(tempRoot, "unused-home"));

    const status = await installCodexHandoffCommand();
    const [promptDir, commandDir] = resolveCodexCommandInstallDirs();
    const installedPrompt = await readFile(join(promptDir, "handoff.md"), "utf8");
    const installedCommand = await readFile(join(commandDir, "handoff.md"), "utf8");

    expect(status).toBe("command_installed");
    expect(resolveCodexCommandDir()).toBe(join(codexHome, "prompts"));
    expect(promptDir).toBe(join(codexHome, "prompts"));
    expect(commandDir).toBe(join(codexHome, "commands"));
    expect(installedPrompt).toContain(
      "Start or reuse a thread-bound handoff from the current Codex session.",
    );
    expect(installedCommand).toBe(installedPrompt);
  });

  it("falls back to ${HOME}/.codex/prompts and ${HOME}/.codex/commands when CODEX_HOME is unset", async () => {
    const home = join(tempRoot, "home");
    vi.stubEnv("CODEX_HOME", "");
    vi.stubEnv("HOME", home);

    const status = await installCodexHandoffCommand();
    const [promptDir, commandDir] = resolveCodexCommandInstallDirs();
    const installedPrompt = await readFile(join(promptDir, "handoff.md"), "utf8");
    const installedCommand = await readFile(join(commandDir, "handoff.md"), "utf8");

    expect(status).toBe("command_installed");
    expect(resolveCodexCommandDir()).toBe(join(home, ".codex/prompts"));
    expect(promptDir).toBe(join(home, ".codex/prompts"));
    expect(commandDir).toBe(join(home, ".codex/commands"));
    expect(installedPrompt).toContain("handoff codex-handoff --format json");
    expect(installedCommand).toBe(installedPrompt);
  });

  it("skips an idempotent re-run without creating duplicates", async () => {
    const codexHome = join(tempRoot, "codex-home");
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubEnv("HOME", join(tempRoot, "unused-home"));

    const firstStatus = await installCodexHandoffCommand();
    const secondStatus = await installCodexHandoffCommand();
    const [promptDir, commandDir] = resolveCodexCommandInstallDirs();
    const promptFiles = await readdir(promptDir);
    const commandFiles = await readdir(commandDir);

    expect(firstStatus).toBe("command_installed");
    expect(secondStatus).toBe("command_install_skipped");
    expect(promptFiles.filter((file) => file === "handoff.md")).toHaveLength(1);
    expect(commandFiles.filter((file) => file === "handoff.md")).toHaveLength(1);
  });

  it("updates existing handoff.md copies when the installed contents drift", async () => {
    const codexHome = join(tempRoot, "codex-home");
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubEnv("HOME", join(tempRoot, "unused-home"));

    await installCodexHandoffCommand();
    const [promptDir, commandDir] = resolveCodexCommandInstallDirs();
    const promptPath = join(promptDir, "handoff.md");
    const commandPath = join(commandDir, "handoff.md");
    await writeFile(promptPath, "# stale prompt\n", "utf8");
    await writeFile(commandPath, "# stale command\n", "utf8");

    const status = await installCodexHandoffCommand();
    const installedPrompt = await readFile(promptPath, "utf8");
    const installedCommand = await readFile(commandPath, "utf8");

    expect(status).toBe("command_updated");
    expect(installedPrompt).toContain("missing_active_thread_context");
    expect(installedCommand).toBe(installedPrompt);
  });
});
