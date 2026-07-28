import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWorkspaceCatalog } from "./fetchWorkspaceCatalog.js";

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

describe("fetchWorkspaceCatalog", () => {
  it("returns the parsed workspaces for a valid catalog response", async () => {
    const workspaces = [
      { id: "job-application-review", displayName: "Job Application Review", description: "Review." },
      { id: "research-brief", displayName: "Research Brief", description: "Brief." },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { workspaces })));

    expect(await fetchWorkspaceCatalog()).toEqual({ ok: true, workspaces });
  });

  it("accepts an empty catalog as a valid (non-error) result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { workspaces: [] })));

    expect(await fetchWorkspaceCatalog()).toEqual({ ok: true, workspaces: [] });
  });

  it("rejects a network failure with a generic safe message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchWorkspaceCatalog();

    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.message : "").not.toContain("network down");
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

    expect((await fetchWorkspaceCatalog()).ok).toBe(false);
  });

  it("rejects a response missing the workspaces field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));

    expect((await fetchWorkspaceCatalog()).ok).toBe(false);
  });

  it("rejects a response where workspaces is not an array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { workspaces: "nope" })));

    expect((await fetchWorkspaceCatalog()).ok).toBe(false);
  });

  it("rejects an entry missing a required field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { workspaces: [{ id: "x", displayName: "X" }] }))
    );

    expect((await fetchWorkspaceCatalog()).ok).toBe(false);
  });

  it("rejects an entry with a non-string metadata value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { workspaces: [{ id: "x", displayName: 5, description: "d" }] })
      )
    );

    expect((await fetchWorkspaceCatalog()).ok).toBe(false);
  });

  it("rejects an entry with an empty or whitespace-only metadata value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { workspaces: [{ id: "x", displayName: "   ", description: "d" }] })
      )
    );

    expect((await fetchWorkspaceCatalog()).ok).toBe(false);
  });

  it("rejects duplicate workspace ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          workspaces: [
            { id: "dup", displayName: "One", description: "d" },
            { id: "dup", displayName: "Two", description: "d" },
          ],
        })
      )
    );

    expect((await fetchWorkspaceCatalog()).ok).toBe(false);
  });

  it("rejects a non-2xx response safely", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" })));

    const result = await fetchWorkspaceCatalog();

    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.message : "").not.toContain("boom");
  });
});
