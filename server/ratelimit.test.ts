import { describe, it, expect, vi } from "vitest";

// Configure the limiter deterministically before routers.ts evaluates its module-level consts.
vi.hoisted(() => {
  process.env.LLM_MAX_CONCURRENCY = "2";
  process.env.LLM_MIN_INTERVAL_MS = "0";
});

// Avoid DB side effects from the scheduler bootstrap when routers.ts loads.
vi.mock("./db", () => ({
  getSchedulerConfig: vi.fn(async () => null),
  getDb: vi.fn(async () => null),
  listGlobalApiKeys: vi.fn(async () => []),
  getPlatformConfig: vi.fn(async () => undefined),
  getSysConfig: vi.fn(async () => undefined),
}));

import { withLlmRateLimit } from "./routers";

describe("withLlmRateLimit", () => {
  it("never exceeds the configured max concurrency", async () => {
    let active = 0;
    let peak = 0;
    const task = () =>
      withLlmRateLimit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return 1;
      });

    await Promise.all(Array.from({ length: 8 }, task));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("propagates the result and stays usable after an error (slot released)", async () => {
    await expect(withLlmRateLimit(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withLlmRateLimit(async () => 42)).resolves.toBe(42);
  });
});
