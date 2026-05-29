import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the data layer and env so the routing chain is fully deterministic and DB-free.
vi.mock("./db", () => ({
  getPlatformConfig: vi.fn(),
  listGlobalApiKeys: vi.fn(),
  getSysConfig: vi.fn(async () => undefined),
}));
vi.mock("./_core/env", () => ({
  ENV: {
    openrouterApiKey: "",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    cookieSecret: "",
    databaseUrl: "",
    isProduction: false,
    googleClientId: "",
    googleClientSecret: "",
  },
}));

import * as db from "./db";
import { __testing } from "./routers";

const { resolveApiConfigChain, callExternalLLM, isRetryableError } = __testing;

const mockedDb = db as unknown as {
  getPlatformConfig: ReturnType<typeof vi.fn>;
  listGlobalApiKeys: ReturnType<typeof vi.fn>;
  getSysConfig: ReturnType<typeof vi.fn>;
};

// Build a fetch Response-like object.
function makeResponse(opts: { ok: boolean; status: number; body?: any; text?: string }): any {
  return {
    ok: opts.ok,
    status: opts.status,
    statusText: `HTTP ${opts.status}`,
    text: async () => opts.text ?? "",
    json: async () => opts.body ?? { choices: [{ message: { content: "ok" } }], model: "mock-model" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no platform key, no global keys.
  mockedDb.getPlatformConfig.mockResolvedValue(undefined);
  mockedDb.listGlobalApiKeys.mockResolvedValue([]);
  mockedDb.getSysConfig.mockResolvedValue(undefined);
});

describe("isRetryableError", () => {
  it("respects an explicit retryable=false flag (4xx / model-not-found)", () => {
    expect(isRetryableError({ retryable: false })).toBe(false);
  });
  it("respects an explicit retryable=true flag (5xx / 429)", () => {
    expect(isRetryableError({ retryable: true })).toBe(true);
  });
  it("treats unflagged errors (timeout / network) as retryable", () => {
    expect(isRetryableError(new Error("network down"))).toBe(true);
    expect(isRetryableError({ name: "AbortError" })).toBe(true);
  });
});

describe("resolveApiConfigChain", () => {
  it("orders candidates: platform key first, then provider chain", async () => {
    mockedDb.getPlatformConfig.mockResolvedValue({
      apiKeyEncrypted: "pk-123",
      apiBaseUrl: "https://primary.example/v1",
      modelVersion: "model-a",
    } as any);
    mockedDb.listGlobalApiKeys.mockResolvedValue([
      { isActive: true, apiKey: "or-key", baseUrl: "https://openrouter.ai/api/v1", name: "OR", coveredPlatforms: [] },
    ] as any);

    const chain = await resolveApiConfigChain("perplexity");
    expect(chain.length).toBe(2);
    expect(chain[0].source).toBe("platform");
    expect(chain[0].baseUrl).toBe("https://primary.example/v1");
    expect(chain[1].label).toBe("openrouter");
    expect(chain[1].baseUrl).toContain("openrouter.ai");
  });

  it("never includes a BAI candidate while BAI is disabled, even for a BAI-covered platform", async () => {
    // claude is in BAI_SUPPORTED_PLATFORMS; provide both a BAI and an OpenRouter global key.
    mockedDb.listGlobalApiKeys.mockResolvedValue([
      { isActive: true, apiKey: "bai-key", baseUrl: "https://api.b.ai/v1", name: "BAI", coveredPlatforms: [] },
      { isActive: true, apiKey: "or-key", baseUrl: "https://openrouter.ai/api/v1", name: "OR", coveredPlatforms: [] },
    ] as any);

    const chain = await resolveApiConfigChain("claude");
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.every((c) => !c.baseUrl.includes("b.ai"))).toBe(true);
    expect(chain.some((c) => c.baseUrl.includes("openrouter.ai"))).toBe(true);
  });

  it("dedupes identical baseUrl+model+key candidates", async () => {
    // Platform key and the openrouter global key resolve to the same endpoint+model+key.
    mockedDb.getPlatformConfig.mockResolvedValue({
      apiKeyEncrypted: "or-key-shared",
      apiBaseUrl: "https://openrouter.ai/api/v1",
      modelVersion: "perplexity/sonar-pro",
    } as any);
    mockedDb.listGlobalApiKeys.mockResolvedValue([
      { isActive: true, apiKey: "or-key-shared", baseUrl: "https://openrouter.ai/api/v1", name: "OR", coveredPlatforms: [] },
    ] as any);

    const chain = await resolveApiConfigChain("perplexity");
    expect(chain.length).toBe(1);
  });

  it("returns an empty chain when nothing is configured", async () => {
    const chain = await resolveApiConfigChain("perplexity");
    expect(chain).toEqual([]);
  });
});

describe("callExternalLLM failover + retry classification", () => {
  it("fails over to the next candidate on a non-retryable 401 (no backoff)", async () => {
    mockedDb.getPlatformConfig.mockResolvedValue({
      apiKeyEncrypted: "pk-123",
      apiBaseUrl: "https://primary.example/v1",
      modelVersion: "model-a",
    } as any);
    mockedDb.listGlobalApiKeys.mockResolvedValue([
      { isActive: true, apiKey: "or-key", baseUrl: "https://openrouter.ai/api/v1", name: "OR", coveredPlatforms: [] },
    ] as any);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeResponse({ ok: false, status: 401, text: "unauthorized" }))
      .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, body: { choices: [{ message: { content: "from-fallback" } }], model: "or-model" } }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await callExternalLLM("perplexity", [{ role: "user", content: "hi" }], "trace-1");
    expect(res.content).toBe("from-fallback");
    // Candidate 1 tried once (no retry on 401), candidate 2 once.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx error on a single candidate", async () => {
    mockedDb.getPlatformConfig.mockResolvedValue({
      apiKeyEncrypted: "pk-123",
      apiBaseUrl: "https://primary.example/v1",
      modelVersion: "model-a",
    } as any);

    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ ok: false, status: 400, text: "bad request" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callExternalLLM("perplexity", [{ role: "user", content: "hi" }], "trace-2")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats model_not_found as non-retryable and fails over to the next provider", async () => {
    mockedDb.getPlatformConfig.mockResolvedValue({
      apiKeyEncrypted: "pk-123",
      apiBaseUrl: "https://primary.example/v1",
      modelVersion: "model-a",
    } as any);
    mockedDb.listGlobalApiKeys.mockResolvedValue([
      { isActive: true, apiKey: "or-key", baseUrl: "https://openrouter.ai/api/v1", name: "OR", coveredPlatforms: [] },
    ] as any);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeResponse({ ok: false, status: 404, text: `{"error":"model_not_found"}` }))
      .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, body: { choices: [{ message: { content: "recovered" } }], model: "or-model" } }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await callExternalLLM("perplexity", [{ role: "user", content: "hi" }], "trace-3");
    expect(res.content).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a clear error when no API key is configured", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(callExternalLLM("perplexity", [{ role: "user", content: "hi" }], "trace-4")).rejects.toThrow(/未配置 API Key/);
  });
});
