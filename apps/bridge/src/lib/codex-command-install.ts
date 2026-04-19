import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CodexCommandInstallStatus =
  | "command_installed"
  | "command_updated"
  | "command_install_skipped";

const COMMAND_FILE_NAME = "handoff.md";
const HOME_CODEX_COMMAND_DIR = ".codex/commands";

function resolvePackagedCommandSourcePath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "../../resources/codex/commands", COMMAND_FILE_NAME);
}

export function resolveCodexCommandDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const codexHome = env.CODEX_HOME?.trim();
  if (codexHome) {
    return join(codexHome, "commands");
  }

  const home = env.HOME?.trim();
  if (home) {
    return join(home, HOME_CODEX_COMMAND_DIR);
  }

  throw new Error(
    "missing_codex_command_dir: set CODEX_HOME or HOME before running handoff install-codex-command",
  );
}

export async function installCodexHandoffCommand(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CodexCommandInstallStatus> {
  const commandDir = resolveCodexCommandDir(env);
  const sourcePath = resolvePackagedCommandSourcePath();
  const targetPath = join(commandDir, COMMAND_FILE_NAME);
  const source = await readFile(sourcePath, "utf8");

  await mkdir(commandDir, { recursive: true, mode: 0o700 });
  await chmod(commandDir, 0o700);

  let existing: string | null = null;
  try {
    existing = await readFile(targetPath, "utf8");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error;
    }
  }

  if (existing === source) {
    return "command_install_skipped";
  }

  await writeFile(targetPath, source, "utf8");

  if (existing === null) {
    return "command_installed";
  }

  return "command_updated";
}
