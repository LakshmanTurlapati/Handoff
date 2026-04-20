import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { createNotification } from "../lib/jsonrpc.js";

export interface RelayConnectionOptions {
  bridgeInstanceId: string;
  bridgeVersion?: string;
  ticketProvider: () => Promise<{ relayUrl: string; ticket: string }>;
  /** Initial reconnect delay in ms. Default 1000. */
  initialReconnectDelay?: number;
  /** Max reconnect delay in ms. Default 30000. */
  maxReconnectDelay?: number;
}

export type RelayConnectionState = "disconnected" | "connecting" | "connected";

export class RelayConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectDelay: number;
  private readonly initialReconnectDelay: number;
  private readonly maxReconnectDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private _state: RelayConnectionState = "disconnected";

  constructor(private readonly options: RelayConnectionOptions) {
    super();
    this.initialReconnectDelay = options.initialReconnectDelay ?? 1000;
    this.maxReconnectDelay = options.maxReconnectDelay ?? 30000;
    this.reconnectDelay = this.initialReconnectDelay;
  }

  get state(): RelayConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    this.intentionalClose = false;
    this._state = "connecting";
    const { relayUrl, ticket } = await this.options.ticketProvider();
    const wsUrl = `${relayUrl}/ws/bridge`;
    this.ws = new WebSocket(wsUrl, {
      headers: { authorization: `Bearer ${ticket}` },
    });

    this.ws.on("open", () => {
      this._state = "connected";
      this.reconnectDelay = this.initialReconnectDelay; // reset on success

      // Send bridge.register notification
      const registerMsg = createNotification("bridge.register", {
        bridgeVersion: this.options.bridgeVersion ?? "0.1.0",
        bridgeInstanceId: this.options.bridgeInstanceId,
      });
      this.ws!.send(JSON.stringify(registerMsg));

      this.emit("connected");
    });

    this.ws.on("message", (data) => {
      const raw = data.toString();
      this.emit("message", raw);
    });

    this.ws.on("close", (code, reason) => {
      this._state = "disconnected";
      this.emit("disconnected", { code, reason: reason.toString() });
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (err) => {
      this.emit("error", err);
    });
  }

  send(message: object): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "bridge shutting down");
      this.ws = null;
    }
    this._state = "disconnected";
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay,
      );
      try {
        await this.connect();
      } catch (err) {
        this.emit("error", err);
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
    this.emit("reconnecting", { delayMs: this.reconnectDelay });
  }
}
