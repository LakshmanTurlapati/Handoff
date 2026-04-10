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

const buckets = new Map<string, Bucket>();

/** Exported for tests to reset state between cases. */
export function __resetRateLimitBuckets(): void {
  buckets.clear();
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
