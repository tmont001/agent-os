import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RunRecord, RunRecordInput, RunStore, RunSummary } from "./RunStore.js";
import { buildInputPreview } from "./runSummary.js";

const SUPPORTED_SCHEMA_VERSION = 1;
const PREVIEW_FETCH_LENGTH = 121;

interface RunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly input: string;
  readonly output: string;
  readonly created_at: string;
}

interface RunPreviewRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly created_at: string;
  readonly input_preview_source: string;
}

function toRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    input: row.input,
    output: row.output,
    createdAt: row.created_at,
  };
}

export interface SqliteRunStoreOptions {
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

/**
 * The only production module allowed to import node:sqlite (M5_DESIGN.md
 * Section 4). Node 24's built-in DatabaseSync requires no dependency;
 * synchronous access is acceptable only because this is a local,
 * single-user, single-process tool — not a claim it suits a concurrent
 * production server.
 */
export class SqliteRunStore implements RunStore {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  /**
   * `now`/`generateId` are test-only hooks (mirroring InMemoryRunStore) so
   * ordering tests can prove the id-descending tie-break deterministically
   * instead of relying on real wall-clock timing. Not part of the RunStore
   * port; production callers pass neither and get the real clock/UUIDs.
   */
  constructor(path: string, options?: SqliteRunStoreOptions) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.now = options?.now ?? (() => new Date());
    this.generateId = options?.generateId ?? (() => crypto.randomUUID());
    this.initSchema();
  }

  private initSchema(): void {
    const { user_version: version } = this.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };

    if (version === 0) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          input TEXT NOT NULL,
          output TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runs_created_at_id ON runs (created_at DESC, id DESC);
      `);
      this.db.exec(`PRAGMA user_version = ${SUPPORTED_SCHEMA_VERSION}`);
      return;
    }

    if (version === SUPPORTED_SCHEMA_VERSION) {
      return;
    }

    this.db.close();
    throw new Error(
      `Unsupported run store schema version ${version} (expected 0 or ${SUPPORTED_SCHEMA_VERSION}).`
    );
  }

  async save(record: RunRecordInput): Promise<RunRecord> {
    const saved: RunRecord = {
      workspaceId: record.workspaceId,
      input: record.input,
      output: record.output,
      id: this.generateId(),
      createdAt: this.now().toISOString(),
    };

    this.db
      .prepare(
        "INSERT INTO runs (id, workspace_id, input, output, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(saved.id, saved.workspaceId, saved.input, saved.output, saved.createdAt);

    return saved;
  }

  async list(): Promise<readonly RunSummary[]> {
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id, created_at, substr(input, 1, ?) as input_preview_source
         FROM runs
         ORDER BY created_at DESC, id DESC`
      )
      .all(PREVIEW_FETCH_LENGTH) as unknown as RunPreviewRow[];

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      createdAt: row.created_at,
      inputPreview: buildInputPreview(row.input_preview_source),
    }));
  }

  async getById(id: string): Promise<RunRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
      | RunRow
      | undefined;
    return row === undefined ? undefined : toRunRecord(row);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM runs WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /**
   * Adapter-specific lifecycle method, not part of the RunStore port — HTTP
   * handlers never close mid-request; server.ts opens one instance for the
   * process lifetime. Tests call this in afterEach for deterministic cleanup.
   */
  close(): void {
    this.db.close();
  }
}
