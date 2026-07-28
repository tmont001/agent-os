import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteRunStore } from "./SqliteRunStore.js";
import type { RunRecordInput } from "./RunStore.js";

const INPUT: RunRecordInput = {
  workspaceId: "job-application-review",
  input: "hello",
  output: "world",
};

let tempDir: string | undefined;
const openStores: SqliteRunStore[] = [];

function trackedStore(
  path: string,
  options?: import("./SqliteRunStore.js").SqliteRunStoreOptions
): SqliteRunStore {
  const store = new SqliteRunStore(path, options);
  openStores.push(store);
  return store;
}

function freshTempPath(): string {
  tempDir = mkdtempSync(join(tmpdir(), "agent-os-run-store-"));
  return join(tempDir, "runs.sqlite3");
}

afterEach(() => {
  for (const store of openStores.splice(0)) {
    store.close();
  }
  if (tempDir !== undefined) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("SqliteRunStore", () => {
  describe("schema/versioning", () => {
    it("initializes the schema from a fresh (user_version 0) database", async () => {
      const store = trackedStore(":memory:");
      const saved = await store.save(INPUT);
      expect(await store.getById(saved.id)).toEqual(saved);
    });

    it("reopens normally at user_version 1, preserving existing data", async () => {
      const path = freshTempPath();
      const first = trackedStore(path);
      const saved = await first.save(INPUT);
      first.close();
      openStores.splice(openStores.indexOf(first), 1);

      const second = trackedStore(path);
      expect(await second.getById(saved.id)).toEqual(saved);
    });

    it("fails initialization safely for an unsupported schema version", () => {
      const path = freshTempPath();
      const seed = new DatabaseSync(path);
      seed.exec("PRAGMA user_version = 2");
      seed.close();

      expect(() => trackedStore(path)).toThrow();
    });
  });

  describe("save/getById/deleteById", () => {
    it("save returns a generated id and a server-owned ISO timestamp", async () => {
      const store = trackedStore(":memory:");
      const before = new Date().toISOString();

      const saved = await store.save(INPUT);

      expect(typeof saved.id).toBe("string");
      expect(saved.id.length).toBeGreaterThan(0);
      expect(saved.createdAt >= before).toBe(true);
      expect(saved.workspaceId).toBe(INPUT.workspaceId);
      expect(saved.input).toBe(INPUT.input);
      expect(saved.output).toBe(INPUT.output);
    });

    it("gets an existing record and returns undefined for a missing one", async () => {
      const store = trackedStore(":memory:");
      const saved = await store.save(INPUT);

      expect(await store.getById(saved.id)).toEqual(saved);
      expect(await store.getById("does-not-exist")).toBeUndefined();
    });

    it("deletes an existing record, then reports missing on repeat deletion", async () => {
      const store = trackedStore(":memory:");
      const saved = await store.save(INPUT);

      expect(await store.deleteById(saved.id)).toBe(true);
      expect(await store.deleteById(saved.id)).toBe(false);
      expect(await store.getById(saved.id)).toBeUndefined();
    });

    it("reports missing for deleting an id that never existed", async () => {
      const store = trackedStore(":memory:");
      expect(await store.deleteById("never-existed")).toBe(false);
    });
  });

  describe("list()", () => {
    it("returns entries newest-first and deterministic across repeated calls", async () => {
      const store = trackedStore(":memory:");
      await store.save(INPUT);
      await store.save(INPUT);
      await store.save(INPUT);

      const first = await store.list();
      const second = await store.list();

      expect(first).toEqual(second);
      const timestamps = first.map((entry) => entry.createdAt);
      const sorted = [...timestamps].sort().reverse();
      expect(timestamps).toEqual(sorted);
    });

    it("orders equal timestamps by id descending", async () => {
      const sameInstant = new Date("2024-01-01T00:00:00.000Z");
      let n = 0;
      const store = trackedStore(":memory:", {
        now: () => sameInstant,
        generateId: () => `id-${n++}`,
      });

      await store.save(INPUT);
      await store.save(INPUT);
      await store.save(INPUT);

      const list = await store.list();
      expect(list.map((entry) => entry.id)).toEqual(["id-2", "id-1", "id-0"]);
    });

    it("returns summaries with no input or output properties", async () => {
      const store = trackedStore(":memory:");
      await store.save(INPUT);

      const [summary] = await store.list();
      expect(summary).toBeDefined();
      expect(Object.keys(summary as object).sort()).toEqual([
        "createdAt",
        "id",
        "inputPreview",
        "workspaceId",
      ]);
    });

    it("respects the preview boundary: 120 chars unchanged, 121 truncated with an ellipsis", async () => {
      const store = trackedStore(":memory:");
      await store.save({ ...INPUT, input: "a".repeat(120) });
      await store.save({ ...INPUT, input: "a".repeat(121) });

      const list = await store.list();
      const previews = list.map((entry) => entry.inputPreview).sort((a, b) => a.length - b.length);

      expect(previews[0]).toBe("a".repeat(120));
      expect(previews[1]).toBe(`${"a".repeat(120)}…`);
    });

    it("never exposes a complete long input or any output content", async () => {
      const longInput = "x".repeat(5000);
      const store = trackedStore(":memory:");
      await store.save({ ...INPUT, input: longInput, output: "super-secret-output" });

      const [summary] = await store.list();
      const raw = JSON.stringify(summary);

      expect(raw).not.toContain(longInput);
      expect(raw).not.toContain("super-secret-output");
      expect((summary as { inputPreview: string }).inputPreview.length).toBeLessThanOrEqual(121);
    });
  });

  describe("storage/cleanup", () => {
    it("operates fully against :memory:", async () => {
      const store = trackedStore(":memory:");
      const saved = await store.save(INPUT);
      expect(await store.list()).toHaveLength(1);
      expect(await store.deleteById(saved.id)).toBe(true);
    });

    it("creates a nested, non-existent directory for a file-backed database", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "agent-os-run-store-"));
      const nestedPath = join(tempDir, "nested", "deeper", "runs.sqlite3");
      expect(existsSync(nestedPath)).toBe(false);

      const store = trackedStore(nestedPath);
      await store.save(INPUT);

      expect(existsSync(nestedPath)).toBe(true);
    });

    it("closes deterministically without throwing", () => {
      const store = new SqliteRunStore(":memory:");
      expect(() => store.close()).not.toThrow();
    });
  });
});
