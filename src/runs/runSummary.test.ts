import { describe, expect, it } from "vitest";
import { buildInputPreview } from "./runSummary.js";

describe("buildInputPreview", () => {
  it("returns empty input unchanged", () => {
    expect(buildInputPreview("")).toBe("");
  });

  it("returns exactly 120 characters unchanged", () => {
    const input = "a".repeat(120);
    expect(buildInputPreview(input)).toBe(input);
    expect(buildInputPreview(input)).not.toContain("…");
  });

  it("truncates 121 characters to 120 plus an ellipsis", () => {
    const input = "a".repeat(121);
    const preview = buildInputPreview(input);

    expect(preview).toBe(`${"a".repeat(120)}…`);
    expect(preview.length).toBe(121);
  });

  it("truncates longer input to 120 plus an ellipsis", () => {
    const input = "a".repeat(500);
    const preview = buildInputPreview(input);

    expect(preview).toBe(`${"a".repeat(120)}…`);
    expect(preview.endsWith("…")).toBe(true);
  });
});
