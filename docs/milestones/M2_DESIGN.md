# M2 Design — Job Application Review Workspace

Status: design only. No application code, dependency installs, or tests exist
yet for M2. Complies with [../Vision.md](../Vision.md),
[../Architecture.md](../Architecture.md), [../PROJECT_RULES.md](../PROJECT_RULES.md),
and [../reviews/M1_ARCHITECTURE_REVIEW.md](../reviews/M1_ARCHITECTURE_REVIEW.md)
(Section 16's recommended M2). Does not redesign or reimplement the
AIProvider port, `executeWorkspace`, workspace resolution, CLI execution,
HTTP execution, error translation, startup configuration, or CI — all
validated by M0/M1 and reused unchanged.

## 1. Purpose

M2 must prove: **`WorkspaceDefinition` (`{ id: string; instructions: string }`)
and `resolveWorkspace`'s map-based lookup generalize to a second, meaningfully
different workspace**, with no change to `executeWorkspace`, `AIProvider`,
the CLI, or the HTTP adapter. This is the oldest disclosed open item carried
from M0 through M1 (M1_ARCHITECTURE_REVIEW.md Section 16).

M2 must **not** attempt structured input, a third workspace, dynamic
discovery, or per-workspace provider/model/tool selection.

## 2. The new workspace

**id:** `job-application-review`

**Purpose:** review one pasted job-application response and return what is
strong, what is weak, and a revised version — treating the user's stated
facts as fixed and never inventing new ones.

**Input contract:** identical to Echo — one plain string through
`executeWorkspace`'s existing `userInput` field. The caller may paste the
application question, their draft answer, and any surrounding context (e.g. a
job description excerpt) together in that one string; the workspace does not
require or parse any internal structure within it.

### Instructions (exact content)

```
You are the Job Application Review workspace. The user will paste one
job-application response — their draft answer to an application question,
possibly with surrounding context such as the question itself or a job
description excerpt included in the same text.

Rules:
- Never invent achievements, metrics, employers, credentials,
  responsibilities, or experience the user did not state.
- Distinguish facts the user supplied from positioning you are suggesting —
  do not blur the two.
- Preserve the user's core meaning and tone; do not rewrite their voice into
  something unrecognizable.
- Be direct rather than flattering. Do not soften real weaknesses.
- Prefer concise, specific language over generic corporate phrasing
  ("results-driven", "team player", "passionate about") — flag or remove it.
- If a claim in the input is unsupported (vague, unverifiable, or
  overstated), flag it explicitly instead of silently making it sound
  stronger.
- Do not repeat the same observation in multiple sections or in different
  words within the same section.
- Do not claim access to the user's resume, a job description, a portfolio,
  or any personal background unless that material appears in the input you
  were actually given. If context seems missing, say so instead of
  assuming it.

Return exactly three sections, in this order, each clearly labeled:

Strong
Needs Work
Revised Response
```

This string is a design artifact here; the production file (Section 6)
contains it verbatim.

**Why this is meaningfully different from Echo, not a variant of it:** Echo's
instructions are a one-line identity transform requiring no judgment. This
workspace's instructions encode a real behavioral contract — a fixed
three-section output shape, an explicit non-fabrication constraint, and a
tone requirement — which only matters if the resolved instructions text
actually reaches the provider unchanged (Section 5).

## 3. WorkspaceDefinition contract decision

**Decision: keep `WorkspaceDefinition` unchanged.**

```ts
interface WorkspaceDefinition {
  readonly id: string;
  readonly instructions: string;
}
```

The new workspace is fully expressible as one `id` and one `instructions`
string — every rule in Section 2 is a sentence inside `instructions`, not a
separate field. No requirement here needs `displayName`/`description` (not
consumed by any adapter), `model`/`provider` (selection is
server-composition-owned, per M1_ARCHITECTURE_REVIEW.md Section 8, not
workspace-owned), `tools`/`memory` (unused by any workspace), `inputSchema`/
`outputSchema` (input stays one plain string; the three-section output shape
is an instruction to the model, not an enforced schema), or
`temperature`/`version`/`metadata` (nothing depends on these).

Two data points both fit `{ id, instructions }` without strain. No proposed
change survives the M1 review's requirement to name "the exact current
requirement that cannot be expressed" — there isn't one. A future frontend
is not evidence for adding fields now, so none are added speculatively.

## 4. Minimal implementation

Production changes: one new workspace-definition file exporting a
`WorkspaceDefinition` object, and one added entry in `resolveWorkspace.ts`'s
lookup map. No change to `executeWorkspace.ts`, `AIProvider.ts`,
`FakeAIProvider.ts`, `resolveWorkspace.ts`'s function signature,
`src/cli/index.ts`, or any production file under `src/http/`. The CLI already
accepts any workspace id via `--workspace <id>`; the HTTP adapter already
accepts any `workspaceId` in the request body; both resolve through the same
`resolveWorkspace` map, so adding an entry is sufficient for both adapters
with zero adapter-level (production) changes. The only planned change under
`src/http/` is the test-only addition to `createApp.test.ts` (Section 6).

## 5. Test strategy

- **Echo still resolves unchanged; unknown workspace behavior unchanged** —
  existing `resolveWorkspace.test.ts` cases stay passing untouched.
- **job-application-review resolves by exact id** — new case mirroring the
  existing Echo case.
- **Both workspaces have nonempty and distinct instructions** — new
  assertion comparing `echoWorkspace.instructions` and
  `jobApplicationReviewWorkspace.instructions` for inequality and non-empty
  length.
- **Instructions actually reach the provider** — `FakeAIProvider`'s output
  (`Echo: ${input}`) does not vary with `instructions`, so it cannot prove
  which instructions were selected. A test-local recording `AIProvider`
  double (`executeWorkspace.test.ts`'s existing `recordingProvider` pattern)
  asserts `generate` was called with
  `{ instructions: jobApplicationReviewWorkspace.instructions, input: ... }`
  when `workspaceId: "job-application-review"` is passed.
- **CLI accepts the new id** — one case in `src/cli/index.e2e.test.ts`
  running `--workspace job-application-review --input "..."`, exit 0,
  through the existing, unmodified CLI.
- **HTTP accepts the new id** — one case in `src/http/createApp.test.ts`
  posting `{ workspaceId: "job-application-review", input: "..." }`, `200`,
  through the existing, unmodified HTTP app.
- **All 80 existing tests remain passing**, no assertion weakened.

## 6. Exact file plan

**Create:**

- `src/workspaces/jobApplicationReviewWorkspace.ts` — exports the
  `job-application-review` `WorkspaceDefinition` constant, structurally
  identical to `echoWorkspace.ts`. Proves Section 2/3: the workspace is
  expressible as `{ id, instructions }`.

**Modify:**

- `src/workspaces/resolveWorkspace.ts` — add one map entry
  (`[jobApplicationReviewWorkspace.id]: jobApplicationReviewWorkspace`).
  Proves resolves-by-id and unknown-id criteria (existing lookup semantics,
  untouched by the addition).
- `src/workspaces/resolveWorkspace.test.ts` — new-id and
  distinct-instructions cases. Proves resolution + distinctness criteria.
- `src/application/executeWorkspace.test.ts` — recording-provider case.
  Proves instructions actually reach `AIProvider`.
- `src/cli/index.e2e.test.ts` — one case through the unmodified CLI. Proves
  CLI-path criterion.
- `src/http/createApp.test.ts` — one case through the unmodified HTTP app
  factory (no production `src/http/` file changes). Proves HTTP-path
  criterion.

Exactly four test files are modified: `resolveWorkspace.test.ts`,
`executeWorkspace.test.ts`, `index.e2e.test.ts`, and `createApp.test.ts`.

`README.md` is not modified in M2 and remains unchanged.

**Do not create:** a workspace registry/loader/factory, a generic
test-helper module, a `services`/`managers` directory, a `shared` package,
or any new dependency. The recording provider is written inline in
`executeWorkspace.test.ts`, following that file's existing
`recordingProvider` helper.

## 7. Explicit exclusions

React/visual UI; new HTTP routes; changes to `POST /v1/runs`'s contract;
changes to the CLI argument contract; new provider behavior; live Anthropic
testing; tools; memory; persistence; run identifiers; authentication; dynamic
workspace discovery; workspace-specific provider/model selection; structured
job-application DTOs (resume/job-description/word-limit fields); a third
workspace; new dependencies; logging; ADR 0003.

## 8. Acceptance criteria

- [ ] `npm ci` succeeds; `npm run typecheck` exits `0`
- [ ] All existing 80 tests remain passing, unweakened
- [ ] All new tests (Section 5) pass
- [ ] `resolveWorkspace("job-application-review")` returns the new definition
- [ ] `resolveWorkspace("echo")` still returns `echoWorkspace`, unchanged
- [ ] `resolveWorkspace("does-not-exist")` still returns `undefined`
- [ ] The two workspaces' `instructions` are both nonempty and unequal
- [ ] A recording provider double proves `executeWorkspace` sends the new
      workspace's exact `instructions` to `AIProvider.generate`
- [ ] The existing CLI (no argument-contract change) runs
      `--workspace job-application-review` successfully
- [ ] The existing HTTP app (no route/contract change) accepts
      `workspaceId: "job-application-review"` successfully
- [ ] No production change to `src/cli/index.ts` or any file under
      `src/http/`; `src/http/createApp.test.ts` receives only its planned
      test-only addition
- [ ] `README.md` remains unchanged
- [ ] `WorkspaceDefinition` is unchanged (Section 3); no evidence-backed
      contradiction was found
- [ ] No new dependency added; no live Anthropic API request made anywhere
- [ ] All Section 7 exclusions remain intact (directory/diff check)
- [ ] GitHub Actions CI passes on the implementation commit

## 9. Implementation and git plan

Checkpoints (validation boundaries, not necessarily commits):

1. Create `jobApplicationReviewWorkspace.ts`; add its map entry. *Validate:*
   typecheck passes.
2. Add `resolveWorkspace.test.ts` cases. *Validate:* those tests pass.
3. Add the recording-provider case to `executeWorkspace.test.ts`.
   *Validate:* that test passes.
4. Add the CLI and HTTP cases. *Validate:* full suite green.

**Recommended git history** (not created in this task):

1. `docs: define M2 job application workspace`
2. `feat: add job application review workspace`
3. `docs: record M2 architecture findings`

The later M2 architecture review should be substantially shorter than the M1
review, focused narrowly on whether `WorkspaceDefinition` held at two
meaningful workspaces — not re-litigating M0/M1's already-validated
boundaries.

## 10. M3 handoff (non-binding)

**M3 — Job Application Review Web Interface.** Expected purpose: prove a
minimal React client can consume `POST /v1/runs` without changing the
validated application or HTTP contracts.

Likely scope: one page, one large text input, a submit button, a loading
state, a safe error state, a results area — consuming the existing
`job-application-review` workspace through the existing `POST /v1/runs`
endpoint, unchanged. Not designed or implemented here.
