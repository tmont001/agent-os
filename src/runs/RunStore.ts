export interface RunRecordInput {
  readonly workspaceId: string;
  readonly input: string;
  readonly output: string;
}

export interface RunRecord extends RunRecordInput {
  readonly id: string;
  readonly createdAt: string;
}

export interface RunSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly inputPreview: string;
}

/**
 * Transport-neutral persistence port for run history (M5_DESIGN.md Section
 * 3). Two implementations exist from the start (InMemoryRunStore,
 * SqliteRunStore), matching the AIProvider port/adapter precedent.
 *
 * getById/deleteById return undefined/false for an unknown id — not found
 * is a normal outcome, not a thrown error. save/list may throw on a genuine
 * storage failure; callers (executeWorkspaceWithHistory, HTTP routes)
 * handle that explicitly. No AgentOsError-style code taxonomy is added
 * here: RunStore failures are local-infrastructure failures with one
 * fallback everywhere, unlike provider failures.
 */
export interface RunStore {
  save(record: RunRecordInput): Promise<RunRecord>;
  list(): Promise<readonly RunSummary[]>;
  getById(id: string): Promise<RunRecord | undefined>;
  deleteById(id: string): Promise<boolean>;
}
