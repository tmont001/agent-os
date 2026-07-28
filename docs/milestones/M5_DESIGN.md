# M5 Design — Run Records, Local Persistence, and History

Status: design only, implementation to follow on this branch. Complies with [../Vision.md](../Vision.md),
[../Architecture.md](../Architecture.md), [../PROJECT_RULES.md](../PROJECT_RULES.md), and
[../reviews/M4_ARCHITECTURE_REVIEW.md](../reviews/M4_ARCHITECTURE_REVIEW.md). Does not redesign
`WorkspaceDefinition`, `resolveWorkspace`, the workspace catalog, the `AIProvider` port, or the frontend
catalog/runner boundaries — validated M0–M4, reused unchanged. `POST /v1/runs`'s **request** schema is
unchanged; its **success response** gains fields (Section 6).

## 1. Purpose

Add durable, local, single-user run history: every successful run is saved so a user can revisit past
output without re-running. This is the most-repeated deferred item since M1 and the M4-recommended next
step. Persistence must never lose a generated result, and must never store secrets, instructions, or raw provider errors.

## 2. Confirmed contract (read from source)

- `executeWorkspace(input, { resolveWorkspace, aiProvider })` returns `{ ok: true; output } | { ok: false;
  error: AgentOsError }` — unchanged since M0. `AIProvider`/`AgentOsError` are unchanged since M0/M1.
- `runsRoute.ts` validates with `RunRequestSchema` (`{ workspaceId: string; input: string }`, `.strict()`),
  calls `executeWorkspace`, returns `200 { output }`. `createApp(deps)` takes `{ resolveWorkspace,
  aiProvider, listWorkspaceCatalog }`; `server.ts` is the only file reading `process.env`/calling `.listen()`.
- `mapErrorToResponse.ts` exports two mappers: `mapHttpErrorToResponse` (pure transport codes —
  `ROUTE_NOT_FOUND`, `METHOD_NOT_ALLOWED`, already reused across `/v1/runs` and `/v1/workspaces`) and
  `mapAgentOsErrorToResponse` (`AgentOsError`-specific). Neither exposes `cause`, stacks, or provider bodies.
- `runWorkspace.ts`/`fetchWorkspaceCatalog.ts` are the only two frontend `fetch` sites; `App.tsx` (202
  lines) holds page state via `useState`; no router exists.
- Node 24 ships a stable built-in `node:sqlite` (`DatabaseSync`), verified working here with no flag and no external package.

## 3. RunRecord, RunSummary, and RunStore

Exactly the required fields — no provider/model, instructions, tags/folders, or ownership:

```ts
export interface RunRecordInput { readonly workspaceId: string; readonly input: string; readonly output: string; }
export interface RunRecord extends RunRecordInput {
  readonly id: string;        // server-generated (crypto.randomUUID())
  readonly createdAt: string; // server-generated, ISO 8601 UTC
}
export interface RunSummary {
  readonly id: string; readonly workspaceId: string; readonly createdAt: string;
  readonly inputPreview: string; // input truncated to 120 chars, "…" if cut
}
```

`save` accepts only `RunRecordInput` — callers cannot supply `id`/`createdAt` (type-level server
ownership). `RunSummary` exists so listing never loads full `input`/`output` per row (Section 5).
`buildInputPreview(input: string): string` (`src/runs/runSummary.ts`) is one pure function shared by every
`RunStore`'s `list()`: ≤120 chars unchanged, longer becomes the first 120 chars plus `"…"`.
`InMemoryRunStore` calls it on the full in-memory `record.input`; `SqliteRunStore` never fetches more than
121 characters of `input` from disk in the first place (Section 4).

**Location:** `src/runs/`, sibling of `src/workspaces/`/`src/providers/`, following the `AIProvider`
port/adapter precedent: a `RunStore` port plus `InMemoryRunStore` (test double, parallel to
`FakeAIProvider`) and `SqliteRunStore` (only module allowed to import `node:sqlite`) — two implementations
from the start justify the interface (`PROJECT_RULES.md` #7).

```ts
export interface RunStore {
  save(record: RunRecordInput): Promise<RunRecord>;
  list(): Promise<readonly RunSummary[]>;              // newest first, no output/input
  getById(id: string): Promise<RunRecord | undefined>; // full record
  deleteById(id: string): Promise<boolean>;            // true iff a row was deleted
}
```

`getById`/`deleteById` return `undefined`/`false` for an unknown id — not found is normal, not a thrown
error. `save`/`list` may throw on a genuine storage failure; callers handle that explicitly (Section 6). No
`AgentOsError`-style code taxonomy is added — RunStore failures are local-infrastructure failures with one
fallback everywhere, unlike provider failures, which the client must distinguish (retryable vs. not).

## 4. SQLite adapter

**No new dependency.** Node 24's built-in `node:sqlite` was verified working with zero flags/packages —
`better-sqlite3` is unnecessary. `DatabaseSync` is synchronous, acceptable only because M5 is a local,
single-user, single-process tool — **not** a claim it suits a concurrent production server.

**Schema** (`SqliteRunStore`'s private concern):

```sql
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, input TEXT NOT NULL, output TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs (created_at);
```

`list()`'s query selects only `id, workspace_id, created_at, substr(input, 1, 121)` — never `output` or
the full `input` column — passing that bounded (≤121-char) string straight into `buildInputPreview`;
`getById` is the only query selecting every column, including full `input`/`output`. All queries use
prepared statements (`db.prepare(...).run/get/all`); ids, input, output, timestamps, and paths are never
string-interpolated into SQL.
- **Versioning** via `PRAGMA user_version`, checked at open: `0` → run the schema above and set it to `1`
  (first run); `1` → open normally; anything else → fail initialization safely (throw before any query)
  rather than operate against an unrecognized schema. No migration framework — one version exists today.
- **Path:** `RUN_STORE_PATH` env var, default `data/runs.sqlite3` (repo-root-relative); the constructor
  creates the containing directory (`fs.mkdirSync(dir, { recursive: true })`) first. `data/` is
  git-ignored; a custom `RUN_STORE_PATH` outside `data/` is the operator's responsibility — the app can't
  edit `.gitignore` on the operator's behalf.
- **Tests/cleanup:** most tests use `:memory:` (isolated, zero cleanup, matches `FakeAIProvider`'s style);
  at least one uses a real temp-file path (`os.tmpdir()` + unique name) to prove directory/file creation,
  deleted in `afterEach`. Every test closes its database deterministically. `close(): void` lives on
  `SqliteRunStore` itself, not the `RunStore` port — HTTP handlers never close mid-request; `server.ts`
  opens one instance for the process lifetime.

## 5. Execution and storage failure semantics

**A successful generation must never be lost because storage failed.** `executeWorkspace.ts` is **not**
modified — a new use case wraps it:

```ts
// src/application/executeWorkspaceWithHistory.ts
export type ExecuteWorkspaceWithHistoryOutput =
  | { ok: true; output: string; runId: string | null; persisted: boolean }
  | { ok: false; error: AgentOsError };
```

It calls the unmodified `executeWorkspace` first. On failure, it returns that error unchanged and **never
calls `runStore.save`** — provider failure creates no record. On success, it attempts `runStore.save(...)`;
if that throws, it catches locally and returns `{ ok: true, output, runId: null, persisted: false }`.
Otherwise `{ ok: true, output, runId, persisted: true }`.

## 6. POST response contract

`200 { "output": "...", "runId": "<id>", "persisted": true }` or `200 { "output": "...", "runId": null,
"persisted": false }`. Request body is unchanged: `{ workspaceId, input }`.

**HTTP status stays `200` in both cases** — it represents whether generation happened, which it did. A
non-2xx status would misrepresent a successful, billable Anthropic call as failed, inviting a wasteful
retry. `persisted` is a secondary signal, not conflated with the primary outcome. No message field is
added for `persisted:false` — the safe copy a user sees is client-owned (Section 8), matching M4's
precedent.

`runsRoute.ts` is a deliberate, evidence-driven change: it now calls `executeWorkspaceWithHistory` and
includes `runId`/`persisted`. `RunRequestSchema`, `executeWorkspace`, and `AIProvider` are untouched.

**Frontend (`runWorkspace.ts`) runtime-validates the new shape**: `output` must be a string; `persisted` a
boolean; `persisted === true` requires a non-empty-string `runId`; `persisted === false` requires `runId
=== null`. Any other combination is treated exactly like today's malformed-response case — the existing
fixed generic error, never the raw body. New tests: persisted success, generated-but-unsaved success, each
malformed combination, and unchanged provider/API-error behavior.

## 7. History HTTP contracts

No query parameters, no pagination — one local user's run count doesn't justify it and no source evidence requires it.

- **`GET /v1/runs`** → `200 { "runs": RunSummary[] }`, newest first (`ORDER BY created_at DESC, id DESC` —
  deterministic even with equal timestamps); no full `input`/`output` in any entry (Section 4).
- **`GET /v1/runs/:id`** → `200 RunRecord` (full `input`/`output`) or `404`.
- **`DELETE /v1/runs/:id`** → `204` on real deletion; `404` if the id doesn't exist, including a repeated
  delete of an already-deleted id — mirrors `WORKSPACE_NOT_FOUND` over a fabricated idempotent success.
  Ids aren't format-validated — malformed or absent both resolve to `404`.
- **Error ownership:** the 404 code is `RUN_NOT_FOUND`, added to the existing transport-level
  `HttpErrorCode` union and returned via `mapHttpErrorToResponse("RUN_NOT_FOUND")` — **not** forced into
  `AgentOsErrorCode`, which is specifically `executeWorkspace`'s domain-failure vocabulary; a missing
  history resource is a transport/route-existence outcome, like the already-shared
  `ROUTE_NOT_FOUND`/`METHOD_NOT_ALLOWED`. Dependency direction: `runHistoryRoute.ts` →
  `mapHttpErrorToResponse` (existing function, one new code) — no new mapping module.
- Unexpected storage failures (list/get/delete throwing) forward to the existing `next(error)` → final
  error middleware, already a safe `500 UNEXPECTED` — reused as-is. No response ever includes an API key,
  instructions, provider/model config, the database path, or a raw driver error.

## 8. Frontend component/state approach

**View state, not a router.** Runner / history-list / run-detail are the same shape
`catalogStatus`/`runStatus` already model with plain `useState`. A router would add a dependency
(disallowed) and URL-sync complexity for no present need. A local `type View = "runner" | "history"` in
`App.tsx` is the smaller coherent option.

**Decomposition (App.tsx is already 202 lines — not growing it further):** `App.tsx` keeps only top-level
nav (`view` state) and its existing runner state/rendering; it mounts a new
`apps/web/src/history/RunHistoryView.tsx` when `view === "history"`. That component owns list/detail/delete
state internally (loading/error/empty/ready, selected-id, delete-confirm) — one focused component, split
further only if it proves unreasonably large. All history HTTP calls live in
`apps/web/src/api/runHistory.ts` (`listRuns`/`getRun`/`deleteRun`), mirroring `fetchWorkspaceCatalog.ts`'s
validation style; `RunHistoryView.tsx` never calls `fetch` directly. `listWorkspaceCatalog()` is
backend-only and never callable from the frontend; `App.tsx` already owns the public catalog it fetched
via `GET /v1/workspaces` for the runner selector, and passes those entries (or a derived `workspaceId →
displayName` map) into `RunHistoryView` as a prop.

- History list fetches on entry (not on initial load): loading / error / empty / ready (workspace +
  timestamp per row, server order).
- **Catalog/history fallback:** each row uses the `displayName` from that prop when a matching entry
  exists, else a safe fallback built from the stored `workspaceId` — a workspace removed from the catalog,
  or missing from the prop for any reason, must not block listing, opening, or deleting that run.
  `RunRecord` never stores `displayName`/`description`; the catalog is never duplicated into storage.
- Selecting a row fetches `GET /v1/runs/:id`: loading / missing (fixed message) / ready (full input/output
  as plain text, reusing the runner's `<pre>` rendering).
- Two-step **Delete** (click → confirm "Delete permanently?" → `DELETE`) via local state, not
  `window.confirm`: idle / deleting / error (fixed message, record stays visible). Success returns to the list.
- "Back" returns to `"runner"`; same `App` instance, so in-progress `input` survives the visit untouched.
- **Persistence-warning:** `persisted: false` adds one fixed line to the runner's result panel —
  client-owned copy.
- **Standing disclosure** (Section 9): a static, always-visible line near the submit control states that
  successful results are saved locally.

## 9. Privacy and local-only boundary

M5 is **local and single-user only**, documented in the design, README, and in-app copy: anyone with
filesystem/application access on the host machine can read all stored run content — no authentication, no
encryption at rest — so this is not suitable for shared/production deployment without both, which remain
out of scope. The UI discloses, via a standing message, that successful runs are saved locally.
"Permanently delete" removes the row from SQLite — no longer visible/retrievable through the application — but is **not** a claim of secure/forensic erasure at the filesystem/disk level.

## 10. Minimal file plan

**Production:** `src/runs/{RunStore,runSummary,InMemoryRunStore,SqliteRunStore}.ts`;
`src/application/executeWorkspaceWithHistory.ts`; `src/http/runHistoryRoute.ts` (list/get/delete handlers);
`runsRoute.ts` (modified, Section 6); `createApp.ts` (inject `runStore`, wire three routes); `server.ts`
(construct `SqliteRunStore` from `RUN_STORE_PATH`); `mapErrorToResponse.ts` (+`RUN_NOT_FOUND`);
`.gitignore` (+`data/`); `apps/web/src/api/runHistory.ts`; `apps/web/src/history/RunHistoryView.tsx`;
`App.tsx` (+nav, Section 8) + `App.css`; `runWorkspace.ts` (modified, Section 6).

**Tests:** `runSummary.test.ts` (120 chars unchanged; 121 → 120 + `"…"`; no `input`/`output` field on a
summary); `SqliteRunStore.test.ts` (save/getById/deleteById, not-found, version-0/1/unsupported, `:memory:`
+ one temp-file case, plus a `list()` case asserting no row exposes full `input`/`output`);
`createApp.test.ts` additions (list/get/DELETE contracts, 404s, newest-first, unchanged POST validation,
unchanged catalog route); `executeWorkspaceWithHistory.test.ts` (success persists; provider failure
persists nothing; storage failure returns output unsaved); `runWorkspace.test.ts` additions (Section 6);
`runHistory.test.ts`; `RunHistoryView.test.tsx` (list/detail/delete, catalog-prop fallback);
`App.test.tsx` additions (nav, persistence-warning, standing disclosure).

**Documentation:** this file and `docs/Roadmap.md`; `README.md` deferred to the implementation pass.

## 11. Explicit exclusions

Authentication, multiple users, cloud sync, sharing, search, filters, pagination, tags, folders, editing
saved runs, rerunning history, failed-run persistence, provider/model metadata, prompt/instruction
persistence, prompt versioning, tools, memory, multi-agent planning, deployment, PostgreSQL, encryption claims.

## 12. Acceptance criteria

1. `RunRecord`/`save` make `id`/`createdAt` uncallable by API callers (type-level); both are always
   server-generated.
2. A provider failure never calls `runStore.save` — zero record created.
3. A save failure after a successful generation still returns the output, with `runId: null`, `persisted:
   false`, and HTTP `200`.
4. `GET /v1/runs` returns `RunSummary[]` — the SQL query itself never selects full `input`/`output`
   (`substr`-bounded) — newest-first and deterministic; `GET /v1/runs/:id`/`DELETE /v1/runs/:id` return
   `404 RUN_NOT_FOUND` for a missing/already-deleted id.
5. `runWorkspace.ts` rejects any malformed `output`/`runId`/`persisted` combination with the existing
   generic client error.
6. A run whose workspace is no longer in the catalog prop still lists, opens, and deletes via the safe
   id-based fallback label; `RunRecord` never stores catalog metadata.
7. No response anywhere includes an API key, instructions, a raw driver error, or the database path;
   `data/` is git-ignored.
8. `executeWorkspace.ts`, `AIProvider.ts`, `WorkspaceDefinition.ts`, and `runRequestSchema.ts` are
   unchanged — confirmed by `git diff --name-only <base>..HEAD -- <those four files>` returning no output.
9. All pre-M5 behaviors remain passing, nothing weakened/removed; fixtures change only where the additive
   response fields or the new `runStore` dependency require it. All new tests are network-free.

## 13. Implementation plan

1. `docs: define M5 run persistence` — this document + Roadmap update.
2. `feat: add run persistence boundary` — `RunStore`, `runSummary`, `InMemoryRunStore`, `SqliteRunStore`,
   `executeWorkspaceWithHistory`, and their tests.
3. `feat: add run history API` — `runHistoryRoute.ts`, `runsRoute.ts` changes, `createApp`/`server`
   wiring, `mapErrorToResponse` addition.
4. `feat: add run history interface` — `App.tsx` nav, `RunHistoryView.tsx`, `runHistory.ts`,
   `runWorkspace.ts` validation, persistence warning.
5. `docs: record M5 architecture findings` — post-implementation review.
