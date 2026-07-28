import type { RunRecord, RunRecordInput, RunStore, RunSummary } from "./RunStore.js";
import { buildInputPreview } from "./runSummary.js";

export interface InMemoryRunStoreOptions {
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

function compareNewestFirst(a: RunRecord, b: RunRecord): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt > b.createdAt ? -1 : 1;
  }
  if (a.id !== b.id) {
    return a.id > b.id ? -1 : 1;
  }
  return 0;
}

/**
 * A real RunStore implementation backed by an in-process array — suitable
 * for application/HTTP tests, parallel to FakeAIProvider. `now`/`generateId`
 * are injectable so ordering tests can use deterministic values instead of
 * relying on real wall-clock timing.
 */
export class InMemoryRunStore implements RunStore {
  private readonly records: RunRecord[] = [];
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options?: InMemoryRunStoreOptions) {
    this.now = options?.now ?? (() => new Date());
    this.generateId = options?.generateId ?? (() => crypto.randomUUID());
  }

  async save(record: RunRecordInput): Promise<RunRecord> {
    const saved: RunRecord = {
      workspaceId: record.workspaceId,
      input: record.input,
      output: record.output,
      id: this.generateId(),
      createdAt: this.now().toISOString(),
    };
    this.records.push(saved);
    return { ...saved };
  }

  async list(): Promise<readonly RunSummary[]> {
    return [...this.records].sort(compareNewestFirst).map((record) => ({
      id: record.id,
      workspaceId: record.workspaceId,
      createdAt: record.createdAt,
      inputPreview: buildInputPreview(record.input),
    }));
  }

  async getById(id: string): Promise<RunRecord | undefined> {
    const found = this.records.find((record) => record.id === id);
    return found === undefined ? undefined : { ...found };
  }

  async deleteById(id: string): Promise<boolean> {
    const index = this.records.findIndex((record) => record.id === id);
    if (index === -1) {
      return false;
    }
    this.records.splice(index, 1);
    return true;
  }
}
