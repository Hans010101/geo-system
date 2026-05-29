import { describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimit } from "./auth";

describe("checkRateLimit", () => {
  it("allows requests within the limit", () => {
    const key = "ip-allow:login";
    resetRateLimit(key);
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit(key, { max: 10, windowMs: 60_000 }, now + i);
      expect(r.allowed).toBe(true);
      expect(r.retryAfterMs).toBe(0);
    }
  });

  it("blocks once max is exceeded and reports a positive retryAfterMs", () => {
    const key = "ip-block:login";
    resetRateLimit(key);
    const now = 2_000_000;
    const opts = { max: 3, windowMs: 60_000 };

    expect(checkRateLimit(key, opts, now).allowed).toBe(true);
    expect(checkRateLimit(key, opts, now).allowed).toBe(true);
    expect(checkRateLimit(key, opts, now).allowed).toBe(true);

    const blocked = checkRateLimit(key, opts, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("isolates counters across different keys", () => {
    const keyA = "ipA:login";
    const keyB = "ipB:login";
    resetRateLimit(keyA);
    resetRateLimit(keyB);
    const now = 3_000_000;
    const opts = { max: 1, windowMs: 60_000 };

    expect(checkRateLimit(keyA, opts, now).allowed).toBe(true);
    // keyA is now exhausted, but keyB must still be allowed.
    expect(checkRateLimit(keyA, opts, now).allowed).toBe(false);
    expect(checkRateLimit(keyB, opts, now).allowed).toBe(true);
  });

  it("recovers after the window expires", () => {
    const key = "ip-window:login";
    resetRateLimit(key);
    const opts = { max: 2, windowMs: 1_000 };
    const start = 4_000_000;

    expect(checkRateLimit(key, opts, start).allowed).toBe(true);
    expect(checkRateLimit(key, opts, start).allowed).toBe(true);
    expect(checkRateLimit(key, opts, start).allowed).toBe(false);

    // Advance past the window — old timestamps are pruned, requests allowed again.
    const later = start + 1_001;
    expect(checkRateLimit(key, opts, later).allowed).toBe(true);
  });

  it("resetRateLimit clears the counter", () => {
    const key = "ip-reset:login";
    resetRateLimit(key);
    const now = 5_000_000;
    const opts = { max: 1, windowMs: 60_000 };

    expect(checkRateLimit(key, opts, now).allowed).toBe(true);
    expect(checkRateLimit(key, opts, now).allowed).toBe(false);
    resetRateLimit(key);
    expect(checkRateLimit(key, opts, now).allowed).toBe(true);
  });
});
