/**
 * In-memory token bucket rate limiter for the unauthenticated
 * POST /api/pairings endpoint (WR-11 from 01-REVIEW.md).
 *
 * Keyed by the caller IP pulled from the standard x-forwarded-for header
 * (Fly's edge sets this). Defaults: 10 creates per 60 seconds per IP.
 *
 * IMPORTANT: This is process-local, so it only protects a SINGLE Fly
 * machine. Multi-machine deploys need a Redis-backed counter — that is
 * tracked as a deferred item and called out in README.md by plan 01-06.
 * We keep the in-memory limiter here because it raises the abuse floor
 * from "trivial" to "per-machine non-trivial" which is enough to close
 * the SEC-06 / WR-11 gap for Phase 1.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * Hard cap on the number of buckets the in-memory Map will hold.
 * WR-GAP-01: the map is keyed by client IP, so without a cap an
 * attacker rotating source IPs (botnet, IPv6 churn, DHCP pool)
 * can grow the Map unboundedly and OOM the container.
 *
 * When the cap is reached, the oldest bucket (smallest
 * `windowStart`) is evicted before a new one is inserted. This is
 * sufficient because we only insert on the fresh-key branch and
 * we insert at most one bucket per limiter call.
 *
 * The number is chosen to be large enough that a legitimate
 * spike of unique callers (e.g., a burst of users on a shared
 * corporate NAT) never trips eviction in practice, while still
 * being small enough to keep the Map's memory footprint in the
 * single-digit megabyte range.
 */
export const RATE_LIMIT_MAX_BUCKETS = 10_000;

const buckets = new Map<string, Bucket>();

/** Exported for tests to reset state between cases. */
export function __resetRateLimitBuckets(): void {
  buckets.clear();
}

/**
 * If the map is at or above the hard cap, evict the single bucket
 * with the smallest `windowStart`. Runs in O(n) over the map but
 * only fires on the fresh-key insert branch, so the amortized
 * cost is bounded: once the map saturates at
 * RATE_LIMIT_MAX_BUCKETS, every new insert evicts exactly one
 * entry.
 *
 * Exported for tests only — production callers should use
 * `checkPairingCreateRateLimit`, which wires this in automatically.
 */
export function evictOldestIfOverCap(): void {
  if (buckets.size < RATE_LIMIT_MAX_BUCKETS) return;
  let oldestKey: string | null = null;
  let oldestWindowStart = Number.POSITIVE_INFINITY;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < oldestWindowStart) {
      oldestWindowStart = bucket.windowStart;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) {
    buckets.delete(oldestKey);
  }
}

/**
 * Check whether a caller identified by `key` (IP address) may perform
 * another pairing-create action. Returns allowed=false when the
 * bucket is full for the current 60-second window.
 */
export function checkPairingCreateRateLimit(
  key: string,
  options: { limit?: number; windowMs?: number; now?: number } = {},
): RateLimitResult {
  const limit = options.limit ?? 10;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now();

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    // WR-GAP-01: cap the map size BEFORE inserting so a fresh-key
    // branch can never grow past RATE_LIMIT_MAX_BUCKETS. Only fires
    // on the fresh-key insert path — existing-bucket increments
    // never touch the cap.
    evictOldestIfOverCap();
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: bucket.windowStart + windowMs,
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: limit - bucket.count,
    resetAt: bucket.windowStart + windowMs,
  };
}

/**
 * Extract the caller IP from a Next.js Request. Prefers the
 * first entry in x-forwarded-for, falls back to x-real-ip, then a
 * literal "unknown" string so unknown callers still get rate-limited
 * under a shared key (safer than opening a bypass).
 */
export function extractClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
