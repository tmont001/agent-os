# M4 Design — Workspace Catalog and Second User-Facing Workspace

Status: design only, implementation to follow on this branch. Complies with
[../Vision.md](../Vision.md), [../Architecture.md](../Architecture.md),
[../PROJECT_RULES.md](../PROJECT_RULES.md), and
[../reviews/M3_ARCHITECTURE_REVIEW.md](../reviews/M3_ARCHITECTURE_REVIEW.md).
Does not redesign `executeWorkspace`, the `AIProvider` port, `POST /v1/runs`,
`WorkspaceDefinition`, `resolveWorkspace`'s resolution behavior, the HTTP
error model, or `apps/web`'s fetch/error/text-rendering boundaries — all
validated M0–M3 and reused unchanged.

## 1. Purpose

Move the web client from one hardcoded workspace to a generic runner over a
small, genuine catalog of user-facing workspaces, without touching
`POST /v1/runs`. This requires exactly one new user-facing workspace (a
selector over a catalog of one is meaningless) and a safe, separate
public-metadata contract so the catalog endpoint can never leak instructions
or internal config.

## 2. Confirmed contract (read from source)

- `WorkspaceDefinition` (`src/workspaces/WorkspaceDefinition.ts`) is exactly
  `{ id: string; instructions: string }` — unchanged since M0.
- `resolveWorkspace` is a literal `Record<string, WorkspaceDefinition>`;
  adding a workspace is one import + one map key (proven at M2).
- `executeWorkspace` takes `{ workspaceId, userInput }` and
  `{ resolveWorkspace, aiProvider }`; input/output are plain strings.
- `createApp` takes `CreateAppDependencies = { resolveWorkspace, aiProvider
  }`, never calls `.listen()`. `POST /v1/runs` body is `{ workspaceId:
  string; input: string }` (`.strict()`); success `{ output: string }`;
  errors `{ error: { code, message, retryable } }`.
- `apps/web/src/App.tsx` hardcodes `WORKSPACE_ID = "job-application-review"`
  and calls `runWorkspace({ workspaceId, input })`
  (`apps/web/src/api/runWorkspace.ts`), the sole `fetch` boundary.

## 3. Second workspace: `research-brief`

New file `src/workspaces/researchBriefWorkspace.ts`, same shape as
`jobApplicationReviewWorkspace.ts` — one `WorkspaceDefinition` literal, no
new fields. Instructions require: use only information present in the
input; never invent sources, quotations, statistics, findings, or
conclusions; distinguish explicit source claims from reasonable inference;
label uncertainty; keep the summary concise; consolidate repeated findings;
identify genuine unanswered questions rather than fabricating gaps; never
claim access to an external source unless it appears in the input; return
exactly three labeled sections in order — `Summary`, `Key Findings`,
`Open Questions`.

`resolveWorkspace.ts` gains one import and one map entry, mirroring the M2
diff exactly. Input/output stay plain strings through the unmodified
`executeWorkspace` and `POST /v1/runs` contracts — no structured research
DTO.

## 4. Public workspace metadata

**Why a separate type.** `WorkspaceDefinition.instructions` is execution-time,
read only by `executeWorkspace` en route to `AIProvider`; it must never
reach a transport boundary. Catalog metadata is a *display-time* contract an
HTTP client reads before a run happens. Coupling them means every future
execution-config field becomes something a route author must remember to
exclude by hand. A separate `WorkspacePublicMetadata { readonly id: string;
readonly displayName: string; readonly description: string }` makes the
public shape correct by construction. `WorkspaceDefinition` is **not**
extended with `displayName`/`description` — no contradiction requires it.

**Explicit mapping, not derivation.** New file
`src/workspaces/workspaceCatalog.ts` holds one literal array referencing
`jobApplicationReviewWorkspace.id` and `researchBriefWorkspace.id` — not a
filter over `resolveWorkspace`'s map. `listWorkspaceCatalog()` returns that
array. Echo is never added to it: still resolvable via
`resolveWorkspace("echo")`, structurally absent from the catalog. Each
entry's `id` is the real workspace's `.id`, so drift is a compile error.

**Location: `src/workspaces/`, not `application/catalog`.**
`resolveWorkspace.ts` — a core-owned mechanism — already lives beside the
data it resolves, not under `src/application/`; `workspaceCatalog.ts`
follows that precedent rather than adding a speculative layer for one
consumer. Dependency direction: `src/http/*` → `workspaceCatalog.ts` →
workspace constants, matching `createApp`'s existing direction toward
`resolveWorkspace`. No registry framework.

## 5. Catalog HTTP contract

New `GET /v1/workspaces`, no params, no auth. Success: `200` with
`{ "workspaces": [{ "id", "displayName", "description" }, ...] }` in
`workspaceCatalog.ts`'s declared array order — deterministic because it's a
literal array, not `Record` iteration.

New `src/http/workspacesRoute.ts`, mirroring `runsRoute.ts`'s
handler-factory shape. `createApp` gains one injected dependency —
`listWorkspaceCatalog: () => readonly WorkspacePublicMetadata[]` — added to
`CreateAppDependencies` alongside `resolveWorkspace`/`aiProvider`. DI (not a
direct import inside `createApp.ts`) is chosen because `createApp.test.ts`
already builds apps from hand-constructed dependency objects; a direct
import would break that isolation for no benefit. `server.ts` passes the
real `listWorkspaceCatalog`. `/v1/workspaces` gets the same "other method →
405 / unmatched → 404" handling `/v1/runs` already has. `POST /v1/runs`,
`runRequestSchema.ts`, and `mapErrorToResponse.ts` are untouched by M4.

## 6. Frontend: generic web runner

- On mount, `App.tsx` calls a new `fetchWorkspaceCatalog()`
  (`apps/web/src/api/fetchWorkspaceCatalog.ts`, the second and only other
  `fetch` site) against `GET /v1/workspaces`.
- States: `loading`, `error` (fetch/parse/validation failed — generic safe
  copy, no retry), `empty` (zero-length array), `ready` (native `<select>`
  in server order). Default selection: `job-application-review` if present,
  else the first entry.
- Selecting an entry updates title/description from that entry's
  `displayName`/`description` and posts that `id` as `workspaceId` through
  the unchanged `runWorkspace(...)` call.
- **Presentation split:** `displayName`/`description` are server-owned. The
  textarea placeholder and submit-button label are pure interaction copy
  with no backend meaning, so they stay in a small client-local map
  (`workspacePresentation.ts`, keyed by id, with a generic fallback) rather
  than growing the metadata endpoint into a UI-schema system.
- One generic input panel and result panel — no per-workspace component
  branching, no routing, no state library.

**Workspace-switch invariants:**

- The selector is disabled whenever `status === "loading"` — a run in
  progress cannot be interrupted by switching workspaces.
- Changing the selected workspace immediately clears prior `output` and
  `errorMessage` state (resets to the idle/empty presentation).
- The textarea's input value is **not** cleared on switch — the same pasted
  material may intentionally be run through a different workspace.
- Every rendered result/error is tied to the workspace id it was requested
  under; a response for one workspace must never render under another
  workspace's heading/description (enforced by deriving the displayed
  heading from current `selectedWorkspaceId`, not from whichever id was in
  flight when the response arrived — a stale in-flight response for a
  since-abandoned selection is discarded, not rendered).

**Catalog response validation.** `fetchWorkspaceCatalog` must not trust
TypeScript types at the network boundary — it validates the parsed JSON at
runtime with a small local type guard/parser (no Zod or other new
dependency in `apps/web`). It safely rejects: malformed JSON; a response
missing `workspaces` or where `workspaces` is not an array; any entry
missing `id`, `displayName`, or `description`; any entry where those fields
are non-string or empty-string; and duplicate `id` values across entries.
Any rejection surfaces the same fixed, generic catalog-error UI copy used
for network failures — the raw response body or parser error is never
logged or rendered.

## 7. Minimal file plan

**Production:** `researchBriefWorkspace.ts`, `resolveWorkspace.ts` (+1
import/entry), `workspaceCatalog.ts`, `src/http/workspacesRoute.ts`,
`createApp.ts` (+dep, +route), `server.ts` (+dep wiring),
`fetchWorkspaceCatalog.ts` (incl. the runtime validator),
`workspacePresentation.ts`, `App.tsx` (catalog fetch, selector, switch
invariants).

**Tests:** workspace resolution for `research-brief`; `executeWorkspace`
recording-fake proof its instructions reach `generate(...)`;
`workspaceCatalog.test.ts` (exactly two entries, in order, no `echo`, no
non-metadata fields, deterministic); `createApp.test.ts`
(`GET /v1/workspaces` success; existing `POST /v1/runs` tests unmodified);
`App.test.tsx` (catalog loading/failure/empty states; switching after a
completed run clears prior output and updates heading; selector disabled
during an in-flight submission; malformed catalog JSON rejected safely;
duplicate workspace ids rejected safely; submission posts the selected
`workspaceId`).

**Documentation:** `docs/milestones/M4_DESIGN.md`; `README.md` — small
addition documenting `GET /v1/workspaces` and the selector.

**Avoided:** registry/plugin framework, dynamic discovery, a `shared/`
package, schema-generation tooling (Zod et al.) in `apps/web`, new
dependencies.

## 8. Explicit exclusions

Persistence, run history, authentication, deployment, tools, memory,
multi-agent planning, user-created workspaces, dynamic plugin loading,
client-selected provider/model, workspace editing/versioning, structured
result parsing, Markdown rendering, a third user-facing workspace, live
Anthropic validation, new frontend routes or pages.

## 9. Acceptance criteria

1. `WorkspaceDefinition` is unchanged (`git diff` on the file is empty).
2. `resolveWorkspace("research-brief")` returns a definition whose
   `instructions` reach `AIProvider.generate(...)` verbatim (recording
   fake). `resolveWorkspace("echo")` still returns the Echo workspace.
3. `listWorkspaceCatalog()` returns exactly two entries, never one with
   `id === "echo"`, in the same deterministic order on repeated calls.
4. No object from `listWorkspaceCatalog()` or `GET /v1/workspaces` contains
   `instructions` or any other execution/config field.
5. `GET /v1/workspaces` returns `200` with the two public entries.
6. **Protected-boundary evidence (concrete, not asserted):** implementation
   validation runs
   `git diff --name-only 506b35c..HEAD -- src/application/executeWorkspace.ts src/providers/AIProvider.ts src/http/runsRoute.ts src/http/runRequestSchema.ts src/http/mapErrorToResponse.ts`
   and the command must return no output.
7. The web app fetches, validates, and renders the catalog on load.
8. The user can switch the selector between both workspaces; switching
   clears prior output/error state, disables during an in-flight run, and
   never renders one workspace's response under another's heading.
9. Malformed catalog JSON and duplicate workspace ids are rejected with
   fixed safe UI copy, never the raw response or parser error.
10. Catalog loading, fetch-failure, and empty-array states each render a
    safe, non-crashing UI.
11. The existing job-application-review flow still works end to end, and
    all pre-M4 backend/frontend tests still pass unmodified.
12. `npm run typecheck:all`, `npm run test:all`, `npm run build:web`,
    `npm audit`, and CI all pass; no automated test makes a live network
    call.

## 10. Implementation plan

1. `docs: define M4 workspace catalog` — this document.
2. `feat: add workspace catalog and research workspace` — Sections 3–5
   production and test changes.
3. `feat: make web runner workspace-aware` — Section 6 production and test
   changes, including switch invariants and catalog validation.
4. `docs: record M4 architecture findings` — post-implementation review.
