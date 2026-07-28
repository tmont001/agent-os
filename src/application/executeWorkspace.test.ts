import { describe, expect, it, vi } from "vitest";
import { executeWorkspace } from "./executeWorkspace.js";
import { FakeAIProvider } from "../providers/FakeAIProvider.js";
import { resolveWorkspace } from "../workspaces/resolveWorkspace.js";
import { echoWorkspace } from "../workspaces/echoWorkspace.js";
import { jobApplicationReviewWorkspace } from "../workspaces/jobApplicationReviewWorkspace.js";
import { researchBriefWorkspace } from "../workspaces/researchBriefWorkspace.js";
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

  it("passes the research-brief workspace's exact instructions, including the accuracy rules, through to the provider request", async () => {
    const { provider, generate } = recordingProvider({ ok: true, output: "unused" });

    await executeWorkspace(
      { workspaceId: "research-brief", userInput: "Hello" },
      { resolveWorkspace, aiProvider: provider }
    );

    expect(generate).toHaveBeenCalledWith({
      instructions: researchBriefWorkspace.instructions,
      input: "Hello",
    });

    const [{ instructions }] = generate.mock.calls[0] as [{ instructions: string }];
    expect(instructions).toContain(
      "Preserve source terminology when paraphrasing if a synonym could " +
        "strengthen, weaken, or change the meaning."
    );
    expect(instructions).toContain(
      'Do not convert neutral language such as "included" into more ' +
        'specific language such as "enrolled" unless the source uses that term.'
    );
    expect(instructions).toContain(
      "Calculations, percentages, comparisons, and other derived values " +
        "must be explicitly labeled as calculated or inferred from the " +
        "supplied figures."
    );
    expect(instructions).toContain(
      "Do not present a calculated value as though it appeared directly " +
        "in the source material."
    );
  });
});
