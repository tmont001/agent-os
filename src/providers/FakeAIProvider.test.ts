import { describe, expect, it } from "vitest";
import { FakeAIProvider } from "./FakeAIProvider.js";

describe("FakeAIProvider", () => {
  it("defaults to deterministic success behavior", async () => {
    const provider = new FakeAIProvider();

    const result = await provider.generate({
      instructions: "irrelevant",
      input: "Hello",
    });

    expect(result).toEqual({ ok: true, output: "Echo: Hello" });
  });

  it("supports explicit constructor-selected failure behavior", async () => {
    const provider = new FakeAIProvider({ behavior: "failure" });

    const result = await provider.generate({
      instructions: "irrelevant",
      input: "Hello",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "PROVIDER_ERROR",
        message: "The fake provider was configured to fail.",
        retryable: false,
      },
    });
  });
});
