export interface RelayInstanceIdentity {
  appName: string;
  machineId: string;
  region: string;
}

const DEFAULT_RELAY_INSTANCE: RelayInstanceIdentity = {
  appName: "codex-mobile-relay",
  machineId: "local-dev-machine",
  region: "local",
};

export function getRelayInstanceIdentity(): RelayInstanceIdentity {
  return {
    appName: process.env.FLY_APP_NAME ?? DEFAULT_RELAY_INSTANCE.appName,
    machineId:
      process.env.FLY_MACHINE_ID ??
      process.env.FLY_ALLOC_ID ??
      DEFAULT_RELAY_INSTANCE.machineId,
    region: process.env.FLY_REGION ?? DEFAULT_RELAY_INSTANCE.region,
  };
}
