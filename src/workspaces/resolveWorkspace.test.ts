import { describe, expect, it } from "vitest";
import { resolveWorkspace } from "./resolveWorkspace.js";
import { echoWorkspace } from "./echoWorkspace.js";
import { jobApplicationReviewWorkspace } from "./jobApplicationReviewWorkspace.js";

describe("resolveWorkspace", () => {
  it("resolves the echo workspace by id", () => {
    expect(resolveWorkspace("echo")).toBe(echoWorkspace);
  });

  it("resolves the job-application-review workspace by id", () => {
    expect(resolveWorkspace("job-application-review")).toBe(
      jobApplicationReviewWorkspace
    );
  });

  it("returns undefined for an unknown workspace id", () => {
    expect(resolveWorkspace("does-not-exist")).toBeUndefined();
  });

  it("has nonempty and distinct instructions for both workspaces", () => {
    expect(echoWorkspace.instructions.length).toBeGreaterThan(0);
    expect(jobApplicationReviewWorkspace.instructions.length).toBeGreaterThan(
      0
    );
    expect(echoWorkspace.instructions).not.toBe(
      jobApplicationReviewWorkspace.instructions
    );
  });
});
