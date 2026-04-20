import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const APP_NAME = "handoff";
const CONFIG_FALLBACK_PATH = "~/.config/handoff";
const STATE_FALLBACK_PATH = "~/.local/state/handoff";
const CONFIG_FILE_NAME = "config.json";
const CREDENTIALS_FILE_NAME = "credentials.json";
const DAEMON_FILE_NAME = "daemon.json";
const DAEMON_LOCK_FILE_NAME = "daemon.lock";

const BridgeBootstrapConfigSchema = z
  .object({
    baseUrl: z.string().url(),
    relayUrl: z.string().url(),
    bridgeInstallationId: z.string().uuid(),
    bridgeInstanceId: z.string().uuid(),
    deviceLabel: z.string().nullable(),
  })
  .strict();

const BridgeCredentialsSchema = z
  .object({
    bridgeBootstrapToken: z.string().min(32),
  })
  .strict();

const BridgeDaemonStateSchema = z
  .object({
    pid: z.number().int().nonnegative(),
    status: z.enum(["starting", "running", "stale", "stopped"]),
    startedAt: z.string().datetime(),
  })
  .strict();

const BridgeDaemonLockSchema = z
  .object({
    pid: z.number().int().nonnegative(),
    bridgeInstanceId: z.string().uuid(),
  })
  .strict();

export type BridgeBootstrapConfig = z.infer<typeof BridgeBootstrapConfigSchema>;
export type BridgeCredentials = z.infer<typeof BridgeCredentialsSchema>;
export type BridgeDaemonState = z.infer<typeof BridgeDaemonStateSchema>;
export type BridgeDaemonLock = z.infer<typeof BridgeDaemonLockSchema>;
export type BridgeBootstrapState = BridgeBootstrapConfig & BridgeCredentials;

function resolveConfigDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, APP_NAME)
    : join(os.homedir(), ".config", APP_NAME);
}

function resolveStateDir(): string {
  return process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, APP_NAME)
    : join(os.homedir(), ".local", "state", APP_NAME);
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureDirectory(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await chmod(path, 0o600);
}

async function readJsonFile<T>(
  path: string,
  schema: z.ZodSchema<T>,
): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function configPath(): string {
  return join(resolveConfigDir(), CONFIG_FILE_NAME);
}

function credentialsPath(): string {
  return join(resolveConfigDir(), CREDENTIALS_FILE_NAME);
}

function daemonPath(): string {
  return join(resolveStateDir(), DAEMON_FILE_NAME);
}

function daemonLockPath(): string {
  return join(resolveStateDir(), DAEMON_LOCK_FILE_NAME);
}

export async function saveBridgeConfig(
  input: BridgeBootstrapConfig,
): Promise<void> {
  const parsed = BridgeBootstrapConfigSchema.parse(input);
  await ensureDirectory(resolveConfigDir());
  await writeJsonFile(configPath(), parsed);
}

export async function loadBridgeConfig(): Promise<BridgeBootstrapConfig | null> {
  await ensureDirectory(resolveConfigDir());
  return readJsonFile(configPath(), BridgeBootstrapConfigSchema);
}

export async function saveBridgeCredentials(
  input: BridgeCredentials,
): Promise<void> {
  const parsed = BridgeCredentialsSchema.parse(input);
  await ensureDirectory(resolveConfigDir());
  await writeJsonFile(credentialsPath(), parsed);
}

export async function loadBridgeCredentials(): Promise<BridgeCredentials | null> {
  await ensureDirectory(resolveConfigDir());
  return readJsonFile(credentialsPath(), BridgeCredentialsSchema);
}

export async function saveBridgeBootstrapState(
  input: BridgeBootstrapState,
): Promise<void> {
  await saveBridgeConfig({
    baseUrl: input.baseUrl,
    relayUrl: input.relayUrl,
    bridgeInstallationId: input.bridgeInstallationId,
    bridgeInstanceId: input.bridgeInstanceId,
    deviceLabel: input.deviceLabel,
  });
  await saveBridgeCredentials({
    bridgeBootstrapToken: input.bridgeBootstrapToken,
  });
  await ensureDirectory(resolveStateDir());
}

export async function loadBridgeBootstrapState(): Promise<BridgeBootstrapState | null> {
  const [config, credentials] = await Promise.all([
    loadBridgeConfig(),
    loadBridgeCredentials(),
  ]);

  if (!config || !credentials) {
    return null;
  }

  return {
    ...config,
    ...credentials,
  };
}

export async function saveBridgeDaemonState(
  input: BridgeDaemonState,
): Promise<void> {
  const parsed = BridgeDaemonStateSchema.parse(input);
  await ensureDirectory(resolveStateDir());
  await writeJsonFile(daemonPath(), parsed);
}

export async function loadBridgeDaemonState(): Promise<BridgeDaemonState | null> {
  await ensureDirectory(resolveStateDir());
  return readJsonFile(daemonPath(), BridgeDaemonStateSchema);
}

export async function saveBridgeDaemonLock(
  input: BridgeDaemonLock,
): Promise<void> {
  const parsed = BridgeDaemonLockSchema.parse(input);
  await ensureDirectory(resolveStateDir());
  await writeJsonFile(daemonLockPath(), parsed);
}

export async function loadBridgeDaemonLock(): Promise<BridgeDaemonLock | null> {
  await ensureDirectory(resolveStateDir());
  return readJsonFile(daemonLockPath(), BridgeDaemonLockSchema);
}

export function describeBridgeStatePaths(): {
  configDir: string;
  stateDir: string;
  configFallback: string;
  stateFallback: string;
  configPath: string;
  credentialsPath: string;
  daemonPath: string;
  daemonLockPath: string;
} {
  return {
    configDir: resolveConfigDir(),
    stateDir: resolveStateDir(),
    configFallback: CONFIG_FALLBACK_PATH,
    stateFallback: STATE_FALLBACK_PATH,
    configPath: configPath(),
    credentialsPath: credentialsPath(),
    daemonPath: daemonPath(),
    daemonLockPath: daemonLockPath(),
  };
}
