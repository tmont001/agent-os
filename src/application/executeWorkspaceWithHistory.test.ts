import { describe, expect, it, vi } from "vitest";
import { executeWorkspaceWithHistory } from "./executeWorkspaceWithHistory.js";
import { FakeAIProvider } from "../providers/FakeAIProvider.js";
import { resolveWorkspace } from "../workspaces/resolveWorkspace.js";
import { InMemoryRunStore } from "../runs/InMemoryRunStore.js";
import type { RunStore } from "../runs/RunStore.js";

function throwingRunStore(): RunStore {
  return {
    save: vi.fn().mockRejectedValue(new Error("disk is full")),
    list: vi.fn(),
    getById: vi.fn(),
    deleteById: vi.fn(),
  };
}

describe("executeWorkspaceWithHistory", () => {
  it("persists exactly workspaceId, input, and output on a successful run", async () => {
    const runStore = new InMemoryRunStore();

    await executeWorkspaceWithHistory(
      { workspaceId: "echo", userInput: "Hello" },
      { resolveWorkspace, aiProvider: new FakeAIProvider(), runStore }
    );

    const [summary] = await runStore.list();
    expect(summary).toBeDefined();
    const saved = await runStore.getById((summary as { id: string }).id);
    expect(saved).toEqual({
      id: saved?.id,
      workspaceId: "echo",
      input: "Hello",
      output: "Echo: Hello",
      createdAt: saved?.createdAt,
    });
  });

  it("returns output, a non-null runId, and persisted:true on a successful save", async () => {
    const runStore = new InMemoryRunStore();

    const result = await executeWorkspaceWithHistory(
      { workspaceId: "echo", userInput: "Hello" },
      { resolveWorkspace, aiProvider: new FakeAIProvider(), runStore }
    );

    expect(result).toEqual({
      ok: true,
      output: "Echo: Hello",
      runId: expect.any(String),
      persisted: true,
    });
  });

  it("never calls save when execution fails (provider failure)", async () => {
    const save = vi.fn();
    const runStore: RunStore = { save, list: vi.fn(), getById: vi.fn(), deleteById: vi.fn() };

    const result = await executeWorkspaceWithHistory(
      { workspaceId: "echo", userInput: "Hello" },
      { resolveWorkspace, aiProvider: new FakeAIProvider({ behavior: "failure" }), runStore }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "PROVIDER_ERROR",
        message: "The fake provider was configured to fail.",
        retryable: false,
      },
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("never calls save when execution fails (application-level failure, e.g. unknown workspace)", async () => {
    const save = vi.fn();
    const runStore: RunStore = { save, list: vi.fn(), getById: vi.fn(), deleteById: vi.fn() };

    const result = await executeWorkspaceWithHistory(
      { workspaceId: "does-not-exist", userInput: "Hello" },
      { resolveWorkspace, aiProvider: new FakeAIProvider(), runStore }
    );

    expect(result.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("still returns the generated output when saving throws", async () => {
    const result = await executeWorkspaceWithHistory(
      { workspaceId: "echo", userInput: "Hello" },
      { resolveWorkspace, aiProvider: new FakeAIProvider(), runStore: throwingRunStore() }
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.output).toBe("Echo: Hello");
  });

  it("returns runId:null and persisted:false when saving throws, without exposing the raw storage error", async () => {
    const result = await executeWorkspaceWithHistory(
      { workspaceId: "echo", userInput: "Hello" },
      { resolveWorkspace, aiProvider: new FakeAIProvider(), runStore: throwingRunStore() }
    );

    expect(result).toEqual({ ok: true, output: "Echo: Hello", runId: null, persisted: false });
    expect(JSON.stringify(result)).not.toContain("disk is full");
  });

  it("passes the exact resolved workspace instructions through to the provider (executeWorkspace unchanged)", async () => {
    const generate = vi.fn().mockResolvedValue({ ok: true, output: "unused" });
    const runStore = new InMemoryRunStore();

    await executeWorkspaceWithHistory(
      { workspaceId: "job-application-review", userInput: "Hello" },
      { resolveWorkspace, aiProvider: { generate }, runStore }
    );

    expect(generate).toHaveBeenCalledTimes(1);
    const [request] = generate.mock.calls[0] as [{ instructions: string; input: string }];
    expect(request.input).toBe("Hello");
  });
});
