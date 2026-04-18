import type { LiveSessionEvent } from "@codex-mobile/protocol/live-session";

export const MAX_BUFFERED_SESSION_EVENTS = 200;

interface SessionBufferBucket {
  events: LiveSessionEvent[];
  lastCursor: number;
}

export class SessionBuffer {
  private readonly buckets = new Map<string, SessionBufferBucket>();

  constructor(private readonly limit = MAX_BUFFERED_SESSION_EVENTS) {}

  append(event: LiveSessionEvent): LiveSessionEvent {
    const bucket = this.buckets.get(event.sessionId) ?? {
      events: [],
      lastCursor: 0,
    };

    bucket.events.push(event);
    bucket.lastCursor = Math.max(bucket.lastCursor, event.cursor);

    while (bucket.events.length > this.limit) {
      bucket.events.shift();
    }

    this.buckets.set(event.sessionId, bucket);
    return event;
  }

  getSince(sessionId: string, cursor?: number | null): LiveSessionEvent[] {
    const bucket = this.buckets.get(sessionId);
    if (!bucket) return [];
    if (cursor == null) return [...bucket.events];
    return bucket.events.filter((event) => event.cursor > cursor);
  }

  getLatestCursor(sessionId: string): number {
    return this.buckets.get(sessionId)?.lastCursor ?? 0;
  }

  clear(): void {
    this.buckets.clear();
  }
}

export const sessionBuffer = new SessionBuffer();
