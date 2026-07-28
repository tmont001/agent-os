import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteRunById, fetchRunById, fetchRunHistory } from "./runHistory.js";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function noBodyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockRejectedValue(new Error("should never be called on this status")),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRunHistory", () => {
  it("returns parsed summaries for a valid response", async () => {
    const runs = [
      { id: "1", workspaceId: "echo", createdAt: "2024-01-01T00:00:00.000Z", inputPreview: "hi" },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { runs })));

    expect(await fetchRunHistory()).toEqual({ ok: true, runs });
  });

  it("accepts an empty list as a valid (non-error) result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { runs: [] })));

    expect(await fetchRunHistory()).toEqual({ ok: true, runs: [] });
  });

  it("rejects a response missing the runs field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));

    expect((await fetchRunHistory()).ok).toBe(false);
  });

  it("rejects a response where runs is not an array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { runs: "nope" })));

    expect((await fetchRunHistory()).ok).toBe(false);
  });

  it("rejects an entry missing a required field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { runs: [{ id: "1", workspaceId: "echo" }] }))
    );

    expect((await fetchRunHistory()).ok).toBe(false);
  });

  it("rejects duplicate summary ids", async () => {
    const entry = { id: "dup", workspaceId: "echo", createdAt: "2024-01-01T00:00:00.000Z", inputPreview: "hi" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { runs: [entry, entry] })));

    expect((await fetchRunHistory()).ok).toBe(false);
  });

  it("rejects malformed JSON safely", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("bad json")),
      } as Response)
    );

    expect((await fetchRunHistory()).ok).toBe(false);
  });

  it("returns a safe message for a network failure, never the raw error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchRunHistory();
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.message : "").not.toContain("network down");
  });

  it("returns a safe message for an unexpected server failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" })));

    const result = await fetchRunHistory();
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.message : "").not.toContain("boom");
  });
});

describe("fetchRunById", () => {
  it("returns the full record for an existing run", async () => {
    const record = {
      id: "1",
      workspaceId: "echo",
      createdAt: "2024-01-01T00:00:00.000Z",
      input: "Hello",
      output: "Echo: Hello",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, record)));

    expect(await fetchRunById("1")).toEqual({ status: "found", record });
  });

  it("returns a missing status for a 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(404, { error: { code: "RUN_NOT_FOUND", message: "Run not found.", retryable: false } })
      )
    );

    expect(await fetchRunById("does-not-exist")).toEqual({ status: "missing" });
  });

  it("returns a safe error for a malformed record shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { id: "1" })));

    const result = await fetchRunById("1");
    expect(result.status).toBe("error");
  });

  it("returns a safe error, without raw detail, for a server failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" })));

    const result = await fetchRunById("1");
    expect(result.status).toBe("error");
    expect(result.status === "error" ? result.message : "").not.toContain("boom");
  });

  it("returns a safe error for a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchRunById("1");
    expect(result.status).toBe("error");
    expect(result.status === "error" ? result.message : "").not.toContain("network down");
  });
});

describe("deleteRunById", () => {
  it("returns deleted for a 204 without attempting to parse a body", async () => {
    const response = noBodyResponse(204);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    expect(await deleteRunById("1")).toEqual({ status: "deleted" });
    expect(response.json).not.toHaveBeenCalled();
  });

  it("returns missing for a 404 without attempting to parse a body", async () => {
    const response = noBodyResponse(404);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    expect(await deleteRunById("does-not-exist")).toEqual({ status: "missing" });
    expect(response.json).not.toHaveBeenCalled();
  });

  it("sends a DELETE request to the exact run path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(noBodyResponse(204));
    vi.stubGlobal("fetch", fetchMock);

    await deleteRunById("abc123");

    expect(fetchMock).toHaveBeenCalledWith("/v1/runs/abc123", { method: "DELETE" });
  });

  it("returns a safe error for an unexpected server failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(noBodyResponse(500)));

    const result = await deleteRunById("1");
    expect(result.status).toBe("error");
  });

  it("returns a safe error for a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await deleteRunById("1");
    expect(result.status).toBe("error");
    expect(result.status === "error" ? result.message : "").not.toContain("network down");
  });
});
