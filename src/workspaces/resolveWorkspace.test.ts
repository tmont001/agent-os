import { describe, expect, it } from "vitest";
import { resolveWorkspace } from "./resolveWorkspace.js";
import { echoWorkspace } from "./echoWorkspace.js";

describe("resolveWorkspace", () => {
  it("resolves the echo workspace by id", () => {
    expect(resolveWorkspace("echo")).toBe(echoWorkspace);
  });

  it("returns undefined for an unknown workspace id", () => {
    expect(resolveWorkspace("does-not-exist")).toBeUndefined();
  });
});
