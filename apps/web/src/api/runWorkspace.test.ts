import { afterEach, describe, expect, it, vi } from "vitest";
import { runWorkspace } from "./runWorkspace.js";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runWorkspace", () => {
  it("posts the exact unchanged request body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { output: "hi", runId: "abc123", persisted: true }));
    vi.stubGlobal("fetch", fetchMock);

    await runWorkspace({ workspaceId: "echo", input: "Hello" });

    expect(fetchMock).toHaveBeenCalledWith("/v1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "echo", input: "Hello" }),
    });
  });

  it("returns output, runId, and persisted:true for a persisted success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { output: "hi", runId: "abc123", persisted: true }))
    );

    expect(await runWorkspace({ workspaceId: "echo", input: "Hello" })).toEqual({
      ok: true,
      output: "hi",
      runId: "abc123",
      persisted: true,
    });
  });

  it("returns output and persisted:false with runId:null for a generated-but-unsaved success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { output: "hi", runId: null, persisted: false }))
    );

    expect(await runWorkspace({ workspaceId: "echo", input: "Hello" })).toEqual({
      ok: true,
      output: "hi",
      runId: null,
      persisted: false,
    });
  });

  it("rejects persisted:true with runId:null as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { output: "hi", runId: null, persisted: true }))
    );

    const result = await runWorkspace({ workspaceId: "echo", input: "Hello" });
    expect(result).toEqual({ ok: false, message: "Something went wrong. Please try again." });
  });

  it("rejects persisted:true with an empty-string runId as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { output: "hi", runId: "", persisted: true }))
    );

    expect((await runWorkspace({ workspaceId: "echo", input: "Hello" })).ok).toBe(false);
  });

  it("rejects persisted:true with a non-string runId as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { output: "hi", runId: 123, persisted: true }))
    );

    expect((await runWorkspace({ workspaceId: "echo", input: "Hello" })).ok).toBe(false);
  });

  it("rejects persisted:false with a non-null string runId as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { output: "hi", runId: "abc123", persisted: false }))
    );

    expect((await runWorkspace({ workspaceId: "echo", input: "Hello" })).ok).toBe(false);
  });

  it("rejects a response missing persisted as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { output: "hi", runId: "abc123" }))
    );

    expect((await runWorkspace({ workspaceId: "echo", input: "Hello" })).ok).toBe(false);
  });

  it("rejects a response missing runId as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { output: "hi", persisted: true }))
    );

    expect((await runWorkspace({ workspaceId: "echo", input: "Hello" })).ok).toBe(false);
  });

  it("rejects a non-string output as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { output: 123, runId: null, persisted: false }))
    );

    expect((await runWorkspace({ workspaceId: "echo", input: "Hello" })).ok).toBe(false);
  });

  it("returns a safe generic message for malformed JSON, never the raw parse error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("not json")),
      } as Response)
    );

    const result = await runWorkspace({ workspaceId: "echo", input: "Hello" });
    expect(result).toEqual({ ok: false, message: "Something went wrong. Please try again." });
  });

  it("returns a safe generic message for a network failure, never the raw error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await runWorkspace({ workspaceId: "echo", input: "Hello" });
    expect(result).toEqual({ ok: false, message: "Something went wrong. Please try again." });
    expect(result.ok === false ? result.message : "").not.toContain("network down");
  });

  it("returns the safe message from a structured API error unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(404, {
          error: { code: "WORKSPACE_NOT_FOUND", message: "No workspace found.", retryable: false },
        })
      )
    );

    expect(await runWorkspace({ workspaceId: "echo", input: "Hello" })).toEqual({
      ok: false,
      message: "No workspace found.",
    });
  });
});
