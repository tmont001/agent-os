import { describe, expect, it } from "vitest";
import { InMemoryRunStore } from "./InMemoryRunStore.js";

const INPUT: import("./RunStore.js").RunRecordInput = {
  workspaceId: "job-application-review",
  input: "hello",
  output: "world",
};

describe("InMemoryRunStore", () => {
  it("generates an id and an ISO timestamp on save", async () => {
    const store = new InMemoryRunStore({ now: () => new Date("2024-01-01T00:00:00.000Z") });

    const saved = await store.save(INPUT);

    expect(typeof saved.id).toBe("string");
    expect(saved.id.length).toBeGreaterThan(0);
    expect(saved.createdAt).toBe("2024-01-01T00:00:00.000Z");
    expect(saved.workspaceId).toBe(INPUT.workspaceId);
    expect(saved.input).toBe(INPUT.input);
    expect(saved.output).toBe(INPUT.output);
  });

  it("gets an existing record and returns undefined for a missing one", async () => {
    const store = new InMemoryRunStore();
    const saved = await store.save(INPUT);

    expect(await store.getById(saved.id)).toEqual(saved);
    expect(await store.getById("does-not-exist")).toBeUndefined();
  });

  it("deletes an existing record, then reports missing on repeat deletion", async () => {
    const store = new InMemoryRunStore();
    const saved = await store.save(INPUT);

    expect(await store.deleteById(saved.id)).toBe(true);
    expect(await store.deleteById(saved.id)).toBe(false);
    expect(await store.getById(saved.id)).toBeUndefined();
  });

  it("reports missing for deleting an id that never existed", async () => {
    const store = new InMemoryRunStore();
    expect(await store.deleteById("never-existed")).toBe(false);
  });

  it("lists newest first by createdAt", async () => {
    let tick = 0;
    const times = [
      "2024-01-01T00:00:00.000Z",
      "2024-01-02T00:00:00.000Z",
      "2024-01-03T00:00:00.000Z",
    ];
    const store = new InMemoryRunStore({
      now: () => new Date(times[tick++] as string),
      generateId: (() => {
        let n = 0;
        return () => `id-${n++}`;
      })(),
    });

    await store.save(INPUT);
    await store.save(INPUT);
    await store.save(INPUT);

    const list = await store.list();
    expect(list.map((entry) => entry.id)).toEqual(["id-2", "id-1", "id-0"]);
  });

  it("orders equal timestamps by id descending", async () => {
    const sameInstant = new Date("2024-01-01T00:00:00.000Z");
    let n = 0;
    const store = new InMemoryRunStore({
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
    const store = new InMemoryRunStore();
    await store.save(INPUT);

    const [summary] = await store.list();
    expect(summary).toBeDefined();
    expect(Object.keys(summary as object).sort()).toEqual([
      "createdAt",
      "id",
      "inputPreview",
      "workspaceId",
    ]);
    expect(summary).not.toHaveProperty("input");
    expect(summary).not.toHaveProperty("output");
  });

  it("does not let a caller mutate internal store state through a returned record", async () => {
    const store = new InMemoryRunStore();
    const saved = await store.save(INPUT);

    const mutable = saved as { input: string };
    mutable.input = "tampered";

    const reread = await store.getById(saved.id);
    expect(reread?.input).toBe(INPUT.input);
  });
});
