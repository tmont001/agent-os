import { describe, expect, it } from "vitest";
import { resolveWorkspace } from "./resolveWorkspace.js";
import { echoWorkspace } from "./echoWorkspace.js";
import { jobApplicationReviewWorkspace } from "./jobApplicationReviewWorkspace.js";
import { researchBriefWorkspace } from "./researchBriefWorkspace.js";

describe("resolveWorkspace", () => {
  it("resolves the echo workspace by id", () => {
    expect(resolveWorkspace("echo")).toBe(echoWorkspace);
  });

  it("resolves the job-application-review workspace by id", () => {
    expect(resolveWorkspace("job-application-review")).toBe(
      jobApplicationReviewWorkspace
    );
  });

  it("resolves the research-brief workspace by id", () => {
    expect(resolveWorkspace("research-brief")).toBe(researchBriefWorkspace);
  });

  it("returns undefined for an unknown workspace id", () => {
    expect(resolveWorkspace("does-not-exist")).toBeUndefined();
  });

  it("has nonempty and distinct instructions for all three workspaces", () => {
    const instructions = [
      echoWorkspace.instructions,
      jobApplicationReviewWorkspace.instructions,
      researchBriefWorkspace.instructions,
    ];

    for (const text of instructions) {
      expect(text.length).toBeGreaterThan(0);
    }
    expect(new Set(instructions).size).toBe(instructions.length);
  });
});
