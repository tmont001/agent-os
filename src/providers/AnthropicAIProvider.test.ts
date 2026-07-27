import { describe, expect, it, vi } from "vitest";
import { AnthropicAIProvider, DEFAULT_ANTHROPIC_MODEL } from "./AnthropicAIProvider.js";

/**
 * All tests in this file are fully offline: the Anthropic SDK client is
 * constructed with a custom `fetch` implementation (a plain function, never
 * global `fetch`), so no test here makes a real network call or requires a
 * real API key.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function successBody(textBlocks: string[]) {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: DEFAULT_ANTHROPIC_MODEL,
    content: textBlocks.map((text) => ({ type: "text", text })),
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function errorBody(type: string, message: string) {
  return { type: "error", error: { type, message } };
}

describe("AnthropicAIProvider (offline)", () => {
  it("translates the request: system, one user message, model, and max_tokens", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, successBody(["hi"])));
    const provider = new AnthropicAIProvider({ apiKey: "test-key", fetch });

    await provider.generate({ instructions: "Be helpful.", input: "Hello" });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.system).toBe("Be helpful.");
    expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
    expect(body.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(body.max_tokens).toBe(1024);
  });

  it("normalizes a single text content block into the output", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, successBody(["Echo: Hello"])));
    const provider = new AnthropicAIProvider({ apiKey: "test-key", fetch });

    const result = await provider.generate({ instructions: "x", input: "Hello" });

    expect(result).toEqual({ ok: true, output: "Echo: Hello" });
  });

  it("concatenates multiple text content blocks and exposes no raw SDK object", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, successBody(["Hello, ", "world!"])));
    const provider = new AnthropicAIProvider({ apiKey: "test-key", fetch });

    const result = await provider.generate({ instructions: "x", input: "Hello" });

    expect(result).toEqual({ ok: true, output: "Hello, world!" });
    if (result.ok) {
      expect(typeof result.output).toBe("string");
    }
  });

  it("translates a 429 rate-limit response to PROVIDER_UNAVAILABLE/retryable", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(429, errorBody("rate_limit_error", "slow down")));
    const provider = new AnthropicAIProvider({ apiKey: "test-key", fetch });

    const result = await provider.generate({ instructions: "x", input: "Hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("translates a 500 server error response to PROVIDER_UNAVAILABLE/retryable", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, errorBody("api_error", "internal error")));
    const provider = new AnthropicAIProvider({ apiKey: "test-key", fetch });

    const result = await provider.generate({ instructions: "x", input: "Hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("translates a 529 overloaded response to PROVIDER_UNAVAILABLE/retryable", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(529, errorBody("overloaded_error", "overloaded")));
    const provider = new AnthropicAIProvider({ apiKey: "test-key", fetch });

    const result = await provider.generate({ instructions: "x", input: "Hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("translates a connection failure (fetch rejects) to PROVIDER_UNAVAILABLE/retryable, covering timeout-like failures too", async () => {
    // The SDK's APIConnectionTimeoutError extends APIConnectionError, and
    // both are handled by the same branch in this adapter, so a rejected
    // fetch call is sufficient to exercise the timeout/connection-failure
    // path without waiting out a real 30s timeout.
    const fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const provider = new AnthropicAIProvider({ apiKey: "test-key", fetch });

    const result = await provider.generate({ instructions: "x", input: "Hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("translates a 400 bad request response to PROVIDER_ERROR/not retryable", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, errorBody("invalid_request_error", "bad request")));
    const provider = new AnthropicAIProvider({ apiKey: "test-key", fetch });

    const result = await provider.generate({ instructions: "x", input: "Hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_ERROR");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("translates a 401 authentication response to PROVIDER_ERROR/not retryable", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, errorBody("authentication_error", "bad key")));
    const provider = new AnthropicAIProvider({ apiKey: "test-key", fetch });

    const result = await provider.generate({ instructions: "x", input: "Hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_ERROR");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("translates a 403 permission response to PROVIDER_ERROR/not retryable", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, errorBody("permission_error", "forbidden")));
    const provider = new AnthropicAIProvider({ apiKey: "test-key", fetch });

    const result = await provider.generate({ instructions: "x", input: "Hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_ERROR");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("never exposes the raw provider body, API key, stack trace, or cause in the public message", async () => {
    const secretKey = "sk-ant-super-secret-test-key";
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          401,
          errorBody("authentication_error", `invalid x-api-key header: ${secretKey}`)
        )
      );
    const provider = new AnthropicAIProvider({ apiKey: secretKey, fetch });

    const result = await provider.generate({ instructions: "x", input: "Hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The public message field — what a caller/renderer is expected to
      // surface — must be a safe, fixed string with no leaked details.
      expect(result.error.message).toBe("The AI provider rejected the request.");
      expect(result.error.message).not.toContain(secretKey);
      expect(result.error.message).not.toContain("invalid x-api-key header");
      expect(result.error.message).not.toMatch(/at .*\(.*:\d+:\d+\)/); // no stack-trace-shaped text
      // cause may carry the raw SDK error for internal diagnostics only —
      // the CLI (Section 7) never reads or renders it, only code/message.
      expect(result.error).toHaveProperty("cause");
    }
  });
});
