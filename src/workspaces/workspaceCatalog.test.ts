import { describe, expect, it } from "vitest";
import { listWorkspaceCatalog } from "./workspaceCatalog.js";
import { jobApplicationReviewWorkspace } from "./jobApplicationReviewWorkspace.js";
import { researchBriefWorkspace } from "./researchBriefWorkspace.js";

describe("listWorkspaceCatalog", () => {
  it("returns exactly two entries in deterministic order", () => {
    const catalog = listWorkspaceCatalog();

    expect(catalog).toHaveLength(2);
    expect(catalog.map((entry) => entry.id)).toEqual([
      jobApplicationReviewWorkspace.id,
      researchBriefWorkspace.id,
    ]);
  });

  it("excludes the echo workspace", () => {
    expect(listWorkspaceCatalog().some((entry) => entry.id === "echo")).toBe(false);
  });

  it("exposes only id, displayName, and description on each entry", () => {
    for (const entry of listWorkspaceCatalog()) {
      expect(Object.keys(entry).sort()).toEqual(["description", "displayName", "id"]);
    }
  });

  it("has a nonempty displayName and description for every entry", () => {
    for (const entry of listWorkspaceCatalog()) {
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("returns the same order and content on repeated calls", () => {
    expect(listWorkspaceCatalog()).toEqual(listWorkspaceCatalog());
  });
});
