import { describe, expect, it, vi } from "vitest";
import { executeWorkspace } from "./executeWorkspace.js";
import { FakeAIProvider } from "../providers/FakeAIProvider.js";
import { resolveWorkspace } from "../workspaces/resolveWorkspace.js";
import { echoWorkspace } from "../workspaces/echoWorkspace.js";
import { jobApplicationReviewWorkspace } from "../workspaces/jobApplicationReviewWorkspace.js";
import type { AIProvider, AIProviderResult } from "../providers/AIProvider.js";

function recordingProvider(result: AIProviderResult): {
  provider: AIProvider;
  generate: ReturnType<typeof vi.fn>;
} {
  const generate = vi.fn().mockResolvedValue(result);
  return { provider: { generate }, generate };
}

describe("executeWorkspace", () => {
  it("succeeds with the Echo workspace and the fake provider", async () => {
    const output = await executeWorkspace(
      { workspaceId: "echo", userInput: "Hello" },
      { resolveWorkspace, aiProvider: new FakeAIProvider() }
    );

    expect(output).toEqual({ ok: true, output: "Echo: Hello" });
  });

  it("normalizes a provider failure without throwing", async () => {
    const output = await executeWorkspace(
      { workspaceId: "echo", userInput: "Hello" },
      { resolveWorkspace, aiProvider: new FakeAIProvider({ behavior: "failure" }) }
    );

    expect(output).toEqual({
      ok: false,
      error: {
        code: "PROVIDER_ERROR",
        message: "The fake provider was configured to fail.",
        retryable: false,
      },
    });
  });

  it("returns WORKSPACE_NOT_FOUND for an unknown workspace and never calls the provider", async () => {
    const { provider, generate } = recordingProvider({ ok: true, output: "unused" });

    const output = await executeWorkspace(
      { workspaceId: "does-not-exist", userInput: "Hello" },
      { resolveWorkspace, aiProvider: provider }
    );

    expect(output).toEqual({
      ok: false,
      error: {
        code: "WORKSPACE_NOT_FOUND",
        message: 'No workspace found for id "does-not-exist".',
        retryable: false,
      },
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for empty input and never calls the provider", async () => {
    const { provider, generate } = recordingProvider({ ok: true, output: "unused" });

    const output = await executeWorkspace(
      { workspaceId: "echo", userInput: "" },
      { resolveWorkspace, aiProvider: provider }
    );

    expect(output).toEqual({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Input must not be empty.",
        retryable: false,
      },
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for whitespace-only input and never calls the provider", async () => {
    const { provider, generate } = recordingProvider({ ok: true, output: "unused" });

    const output = await executeWorkspace(
      { workspaceId: "echo", userInput: "   " },
      { resolveWorkspace, aiProvider: provider }
    );

    expect(output).toEqual({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Input must not be empty.",
        retryable: false,
      },
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("passes the resolved workspace's instructions through to the provider request", async () => {
    const { provider, generate } = recordingProvider({ ok: true, output: "unused" });

    await executeWorkspace(
      { workspaceId: "echo", userInput: "Hello" },
      { resolveWorkspace, aiProvider: provider }
    );

    expect(generate).toHaveBeenCalledWith({
      instructions: echoWorkspace.instructions,
      input: "Hello",
    });
  });

  it("passes the job-application-review workspace's exact instructions through to the provider request", async () => {
    const { provider, generate } = recordingProvider({ ok: true, output: "unused" });

    await executeWorkspace(
      { workspaceId: "job-application-review", userInput: "Hello" },
      { resolveWorkspace, aiProvider: provider }
    );

    expect(generate).toHaveBeenCalledWith({
      instructions: jobApplicationReviewWorkspace.instructions,
      input: "Hello",
    });
  });
});
