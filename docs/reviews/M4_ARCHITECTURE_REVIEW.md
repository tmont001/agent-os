# M4 Architecture Review — Workspace Catalog and Generic Runner

Status: post-implementation review, conducted on branch `m4-workspace-catalog`
after commits `890200d` (design), `5188ded` (backend/catalog), `dd66aef`
(frontend generic runner). Evidence-based: every claim below is tied to a
file read or command re-run in this session, or explicitly marked
user-confirmed.

## Verdict

**VALIDATED.**

## Evidence

- `research-brief` is a second genuine user-facing workspace: its
  instructions (`researchBriefWorkspace.ts`) encode a distinct behavioral
  contract (accuracy/terminology rules, calculated-value labeling, a
  three-section `Summary`/`Key Findings`/`Open Questions` output) — not a
  placeholder or copy of `job-application-review`.
- `WorkspaceDefinition` (`{ id, instructions }`) is unchanged — confirmed by
  the required protected-boundary command below returning no output.
- `resolveWorkspace("echo")` still returns `echoWorkspace`
  (`resolveWorkspace.test.ts`); Echo is never added to
  `workspaceCatalog.ts`'s literal array, so it is structurally absent from
  `listWorkspaceCatalog()` (`workspaceCatalog.test.ts`: "excludes the echo
  workspace").
- Public metadata (`WorkspacePublicMetadata`) exposes only `id`,
  `displayName`, `description` — asserted directly
  (`workspaceCatalog.test.ts`, `createApp.test.ts`: "exposes no instructions
  or other internal/execution fields").
- Catalog order is deterministic: a literal array, not `Record` iteration;
  `createApp.test.ts` ("returns the same order on repeated requests") and
  `workspaceCatalog.test.ts` ("returns the same order and content on
  repeated calls") both assert it.
- `GET /v1/workspaces` is dependency-injected: `CreateAppDependencies` gained
  `listWorkspaceCatalog`, wired the same way as `resolveWorkspace`/
  `aiProvider`; `server.ts` passes the real function, `createApp.test.ts`
  passes it explicitly per test — app-factory testability preserved.
- `POST /v1/runs` and the protected execution boundary
  (`executeWorkspace.ts`, `AIProvider.ts`, `runsRoute.ts`,
  `runRequestSchema.ts`, `mapErrorToResponse.ts`, `WorkspaceDefinition.ts`)
  are unchanged — `git diff --name-only 506b35c..HEAD -- <those six files>`
  returned no output this session.
- The frontend discovers workspaces: `App.tsx` calls `fetchWorkspaceCatalog()`
  on mount and renders a `<select>` from the response. `App.tsx` still
  defines `DEFAULT_WORKSPACE_ID = "job-application-review"`, but only as a
  preferred *initial selection*: if that id is absent from the catalog, the
  first returned entry is selected instead. The set of selectable options,
  the id actually submitted to `POST /v1/runs`, and everything rendered
  (title/description) are all catalog-driven at runtime, not fixed at build
  time — there is no longer an execution path permanently tied to one
  workspace.
- The selected id is submitted correctly: `runWorkspace({ workspaceId, input
  })` uses `selectedWorkspaceId`, asserted end-to-end in
  `App.test.tsx` ("switching the selector updates the heading/description
  and the workspaceId used for submission").
- Input persists and prior output/error clears on switch:
  `handleWorkspaceChange` resets `output`/`errorMessage`/`runStatus` but
  never touches `input` — both behaviors asserted directly.
- The selector is `disabled={runStatus === "loading"}` — asserted
  ("disables the workspace selector while a run is in flight").
- Catalog JSON is runtime-validated by a local type guard/parser in
  `fetchWorkspaceCatalog.ts` (no new dependency) rejecting malformed JSON,
  non-array/missing `workspaces`, invalid/empty entries, and duplicate ids —
  12 dedicated unit tests plus 4 integration-level tests in `App.test.tsx`.
- Output remains text-only: unchanged `<pre>` rendering path from M3, still
  covered by the "renders model output as text, not injected HTML" test.
- **99 backend and 33 frontend tests pass**, re-run this session
  (`npm run test:all`).
- `npm run typecheck:all`, `npm run build:web`, and `npm audit` (0
  vulnerabilities) all pass this session; `git diff --check` reports no
  whitespace errors; CI is **user-confirmed green**.
- All new/updated tests use `FakeAIProvider`, test-local doubles, or mocked
  `fetch` — no automated test calls Anthropic or a real network socket.

## Visual QA

**User-confirmed.** Desktop and mobile layouts, the polished native selector
(placement, chevron, hover/focus/disabled states), both workspace flows
(Job Application Review and Research Brief), the in-flight disabled state,
the per-workspace trust notes, and Research Brief's output were manually
reviewed and approved by the user on this branch.

## Scope

Confirmed absent (by reading the full diff and `apps/web/package.json`): no
persistence, run history, authentication, deployment config, tool-calling,
memory, client-side routing (`react-router` not a dependency, still one
`App.tsx`), a plugin/registry system, user-created workspaces, a third
user-facing workspace, a `shared/` DTO package (frontend types stay local,
mirroring M3's precedent), and no client-selected provider/model (`POST
/v1/runs` still rejects unknown fields; `GET /v1/workspaces` takes no query
parameters).

## Architectural finding

M4 proves Agent OS is now a genuine multi-workspace platform, not a
hardcoded single-workspace client. The evidence: adding `research-brief`
required exactly one new workspace file plus one `resolveWorkspace` map
entry (the same shape M2 already validated at n=2, now exercised at n=3
without strain); the public/execution metadata split
(`WorkspacePublicMetadata` vs. `WorkspaceDefinition`) means a new workspace
becomes user-facing only through an explicit, reviewable catalog entry, not
by accident; and the frontend never permanently hardcodes which workspace
executes — it is fully catalog-driven. A fourth workspace's public catalog
entry could appear, be selected, and execute with no *structural* frontend
change, because `getWorkspacePresentation`'s generic fallback in
`workspacePresentation.ts` covers any unrecognized id. Workspace-specific
placeholder, submit-button, loading, and trust-note copy would still need
one new entry added to `workspacePresentation.ts` — a small, additive,
client-local change, not a new page, route, form, fetch boundary, or
execution flow.

## M5 recommendation

**M5 — Run persistence and history.** This is the most-repeated deferred
item (M1 through M4) and is now the one piece of demonstrated user value
missing: with two real workspaces and a generic runner, users will
naturally want to revisit a past Research Brief or Job Application Review
result, which the current stateless request/response model cannot support.
No implementation is proposed here; M5 requires its own design pass.

## Closeout

**M4 READY TO CLOSE.** The branch should be merged after this review is
approved — the working tree is clean, all three milestone commits are in
place, typecheck/tests/build/audit all pass reproducibly locally, CI is
confirmed green, and visual QA is user-confirmed. No open follow-up items
block closure.
