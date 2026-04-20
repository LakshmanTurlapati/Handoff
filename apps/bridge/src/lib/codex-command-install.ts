import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CodexCommandInstallStatus =
  | "command_installed"
  | "command_updated"
  | "command_install_skipped";

const COMMAND_FILE_NAME = "handoff.md";
const CODEX_PROMPT_DIR_NAME = "prompts";
const CODEX_COMMAND_DIR_NAME = "commands";
const HOME_CODEX_DIR = ".codex";
const HOME_CODEX_PROMPT_DIR = join(HOME_CODEX_DIR, CODEX_PROMPT_DIR_NAME);
const HOME_CODEX_COMMAND_DIR = join(HOME_CODEX_DIR, CODEX_COMMAND_DIR_NAME);

function resolvePackagedCommandSourcePath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "../../resources/codex/commands", COMMAND_FILE_NAME);
}

export function resolveCodexCommandInstallDirs(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const codexHome = env.CODEX_HOME?.trim();
  if (codexHome) {
    return [CODEX_PROMPT_DIR_NAME, CODEX_COMMAND_DIR_NAME].map((dirName) =>
      join(codexHome, dirName),
    );
  }

  const home = env.HOME?.trim();
  if (home) {
    return [HOME_CODEX_PROMPT_DIR, HOME_CODEX_COMMAND_DIR].map((dirName) =>
      join(home, dirName),
    );
  }

  throw new Error(
    "missing_codex_command_dir: set CODEX_HOME or HOME before running handoff install-codex-command",
  );
}

export function resolveCodexCommandDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const commandDir = resolveCodexCommandInstallDirs(env).at(0);
  if (!commandDir) {
    throw new Error("missing_codex_command_dir");
  }
  return commandDir;
}

async function syncCommandFile(targetPath: string, source: string): Promise<{
  created: boolean;
  updated: boolean;
}> {
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
    return { created: false, updated: false };
  }

  await writeFile(targetPath, source, "utf8");

  if (existing === null) {
    return { created: true, updated: false };
  }

  return { created: false, updated: true };
}

export async function installCodexHandoffCommand(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CodexCommandInstallStatus> {
  const commandDirs = [...new Set(resolveCodexCommandInstallDirs(env))];
  const sourcePath = resolvePackagedCommandSourcePath();
  const source = await readFile(sourcePath, "utf8");

  let createdAny = false;
  let updatedAny = false;

  for (const commandDir of commandDirs) {
    await mkdir(commandDir, { recursive: true, mode: 0o700 });
    await chmod(commandDir, 0o700);

    const result = await syncCommandFile(join(commandDir, COMMAND_FILE_NAME), source);
    createdAny ||= result.created;
    updatedAny ||= result.updated;
  }

  if (updatedAny) {
    return "command_updated";
  }

  if (createdAny) {
    return "command_installed";
  }

  return "command_install_skipped";
}
