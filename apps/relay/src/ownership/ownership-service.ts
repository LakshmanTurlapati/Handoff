import {
  findActiveBridgeLeaseForSession,
  findActiveBridgeLeaseForUser,
  setAttachedSessionOnLease,
  type RelayBridgeLeaseRow,
} from "@codex-mobile/db";
import {
  getRelayInstanceIdentity,
  type RelayInstanceIdentity,
} from "./relay-instance.js";

export type OwnerResolutionStatus =
  | "local_owner"
  | "owner_not_local"
  | "bridge_owner_missing";

export interface OwnerResolution {
  status: OwnerResolutionStatus;
  lease: RelayBridgeLeaseRow | null;
  ownerMachineId?: string;
  ownerRegion?: string;
}

interface OwnershipServiceDependencies {
  findActiveBridgeLeaseForUser?: typeof findActiveBridgeLeaseForUser;
  findActiveBridgeLeaseForSession?: typeof findActiveBridgeLeaseForSession;
  setAttachedSessionOnLease?: typeof setAttachedSessionOnLease;
  getRelayInstanceIdentity?: () => RelayInstanceIdentity;
}

export class OwnershipService {
  private readonly findActiveBridgeLeaseForUser: typeof findActiveBridgeLeaseForUser;
  private readonly findActiveBridgeLeaseForSession: typeof findActiveBridgeLeaseForSession;
  private readonly setAttachedSessionOnLease: typeof setAttachedSessionOnLease;
  private readonly getRelayInstanceIdentity: () => RelayInstanceIdentity;

  constructor(dependencies: OwnershipServiceDependencies = {}) {
    this.findActiveBridgeLeaseForUser =
      dependencies.findActiveBridgeLeaseForUser ?? findActiveBridgeLeaseForUser;
    this.findActiveBridgeLeaseForSession =
      dependencies.findActiveBridgeLeaseForSession ??
      findActiveBridgeLeaseForSession;
    this.setAttachedSessionOnLease =
      dependencies.setAttachedSessionOnLease ?? setAttachedSessionOnLease;
    this.getRelayInstanceIdentity =
      dependencies.getRelayInstanceIdentity ?? getRelayInstanceIdentity;
  }

  async resolveOwnerForUser(userId: string): Promise<OwnerResolution> {
    const lease = await this.findActiveBridgeLeaseForUser({ userId });
    return this.classifyLease(lease);
  }

  async resolveOwnerForSession(sessionId: string): Promise<OwnerResolution> {
    const lease = await this.findActiveBridgeLeaseForSession({ sessionId });
    return this.classifyLease(lease);
  }

  isLocalOwner(lease: Pick<RelayBridgeLeaseRow, "relayMachineId">): boolean {
    return lease.relayMachineId === this.getRelayInstanceIdentity().machineId;
  }

  async recordAttachedSession(input: {
    userId: string;
    sessionId: string;
  }): Promise<void> {
    await this.setAttachedSessionOnLease({
      userId: input.userId,
      attachedSessionId: input.sessionId,
    });
  }

  async clearAttachedSession(input: {
    userId?: string;
    sessionId: string;
  }): Promise<void> {
    if (input.userId) {
      await this.setAttachedSessionOnLease({
        userId: input.userId,
        attachedSessionId: null,
      });
      return;
    }

    const lease = await this.findActiveBridgeLeaseForSession({
      sessionId: input.sessionId,
    });
    if (!lease) {
      return;
    }

    await this.setAttachedSessionOnLease({
      userId: lease.userId,
      attachedSessionId: null,
    });
  }

  private classifyLease(lease: RelayBridgeLeaseRow | null): OwnerResolution {
    if (!lease) {
      return {
        status: "bridge_owner_missing",
        lease: null,
      };
    }

    const now = Date.now();
    if (
      lease.disconnectedAt !== null ||
      lease.expiresAt.getTime() <= now
    ) {
      return {
        status: "bridge_owner_missing",
        lease,
        ownerMachineId: lease.relayMachineId,
        ownerRegion: lease.relayRegion,
      };
    }

    if (this.isLocalOwner(lease)) {
      return {
        status: "local_owner",
        lease,
        ownerMachineId: lease.relayMachineId,
        ownerRegion: lease.relayRegion,
      };
    }

    return {
      status: "owner_not_local",
      lease,
      ownerMachineId: lease.relayMachineId,
      ownerRegion: lease.relayRegion,
    };
  }
}

export const ownershipService = new OwnershipService();
