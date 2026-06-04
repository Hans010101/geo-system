import { describe, expect, it, vi, beforeEach } from "vitest";
import { invokeLLM } from "./_core/llm";

// Capture the JSON body sent to the LLM endpoint.
function stubFetchCapturing(): { calls: any[] } {
  const calls: any[] = [];
  const fetchMock = vi.fn(async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "",
      json: async () => ({
        id: "x",
        created: 0,
        model: "mock",
        choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }],
      }),
    } as any;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

const base = {
  apiKey: "k",
  baseUrl: "https://openrouter.ai/api/v1",
  model: "google/gemini-2.0-flash-001",
  messages: [{ role: "user" as const, content: "hi" }],
};

beforeEach(() => vi.clearAllMocks());

describe("invokeLLM payload", () => {
  it("does NOT inject a non-standard `thinking` parameter", async () => {
    const { calls } = stubFetchCapturing();
    await invokeLLM({ ...base });
    expect(calls[0]).not.toHaveProperty("thinking");
  });

  it("defaults max_tokens to 4096 (not the old hardcoded 32768)", async () => {
    const { calls } = stubFetchCapturing();
    await invokeLLM({ ...base });
    expect(calls[0].max_tokens).toBe(4096);
  });

  it("honors an explicit maxTokens", async () => {
    const { calls } = stubFetchCapturing();
    await invokeLLM({ ...base, maxTokens: 1000 });
    expect(calls[0].max_tokens).toBe(1000);
  });

  it("honors the snake_case max_tokens", async () => {
    const { calls } = stubFetchCapturing();
    await invokeLLM({ ...base, max_tokens: 2000 });
    expect(calls[0].max_tokens).toBe(2000);
  });
});
