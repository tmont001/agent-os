# Roadmap

Status: M0 through M4 are complete, reviewed, and merged to `main`. A
post-M3 live-Anthropic validation checkpoint has also been completed
manually. M5 is defined below as the next milestone; everything after M5
remains provisional or explicitly deferred, per
[Architecture.md](Architecture.md) and [PROJECT_RULES.md](PROJECT_RULES.md).

**Central goal (unchanged since Vision.md):** recurring AI work becomes
tested, controlled, reusable workflows — not one-off chat sessions. Each
milestone should move Agent OS closer to that, not merely add a feature for
its own sake.

## Completed

### M0 — Echo walking skeleton and provider-neutral execution

A CLI input adapter invokes one application use case (`executeWorkspace`)
against a single reference workspace (Echo), through a provider-neutral
`AIProvider` port with two independent implementations: `FakeAIProvider`
(default, network-free) and `AnthropicAIProvider` (SDK-isolated, offline
translation-tested). Provider failures are normalized into Agent OS's own
error shape before reaching the CLI. See
[docs/reviews/M0_ARCHITECTURE_REVIEW.md](reviews/M0_ARCHITECTURE_REVIEW.md)
— **VALIDATED WITH FOLLOW-UP** (live Anthropic path deferred; closed by the
post-M3 checkpoint below).

### M1 — HTTP application boundary and CI

An Express HTTP adapter (`POST /v1/runs`) wraps `executeWorkspace` with
**zero changes** to `executeWorkspace.ts`, `AIProvider.ts`,
`AgentOsError.ts`, `FakeAIProvider.ts`, or any M0 test — proving the
application boundary is transport-agnostic. Adds Zod request validation,
type-enforced public/internal error-code separation
(`PublicResponseCode` excludes `PROVIDER_MISCONFIGURED`), server-owned
(never client-selected) provider configuration, and a minimal CI workflow
(`npm ci`, typecheck, network-free tests). See
[docs/reviews/M1_ARCHITECTURE_REVIEW.md](reviews/M1_ARCHITECTURE_REVIEW.md)
— **VALIDATED WITH FOLLOW-UP**.

### M2 — Job Application Review workspace and `WorkspaceDefinition` at two workspaces

A second, meaningfully different workspace (`job-application-review`, a real
behavioral contract vs. Echo's identity transform) is added as one file plus
one `resolveWorkspace` map entry — no registry, loader, or contract change.
Both workspaces resolve and execute through the unmodified CLI and HTTP
adapters. Closes M0/M1's oldest open item: `{ id, instructions }` holds at
n=2 without strain. See
[docs/reviews/M2_ARCHITECTURE_REVIEW.md](reviews/M2_ARCHITECTURE_REVIEW.md)
— **VALIDATED**.

### M3 — React Job Application Review web interface

A single-page React client (`apps/web`, native npm workspace) submits one
job-application response to `POST /v1/runs` with `workspaceId:
"job-application-review"`, through a single `fetch` boundary
(`api/runWorkspace.ts`). Success and safe structured errors are handled;
output is rendered as plain text only (never HTML/Markdown). A local Vite
dev proxy avoids any backend CORS change. **Zero changes to `src/`**
(`git diff --name-only 26b8f70..HEAD -- src` empty). 85 backend + 11
frontend tests pass; production build and audit clean; CI extended to cover
both. See
[docs/reviews/M3_ARCHITECTURE_REVIEW.md](reviews/M3_ARCHITECTURE_REVIEW.md)
— **VALIDATED**.

### Post-M3 checkpoint — live Anthropic web validation

After M3 closed, a real Anthropic API call was made end-to-end through the
web client (`AI_PROVIDER=anthropic`) and succeeded. Notes:

- This required API billing/credits on the account used.
- The API key stayed local in an ignored `.env` file — never committed,
  logged, or exposed to the browser (the browser only ever talks to the
  local backend; the key is read server-side only, per M1's existing
  configuration model).
- This was a **manual, one-time validation**, not an automated test — it is
  not part of `npm test`, `npm run test:all`, or CI, consistent with every
  milestone's stated policy that the default suite stays network-free.
- No key, account balance, raw credentials, or user-submitted application
  text is recorded here or anywhere in the repository.

This closes the "live Anthropic path unvalidated" follow-up item disclosed
in the M0 and M1 reviews.

### M4 — Workspace Catalog and Generic Runner

A second, genuine user-facing workspace (`research-brief`) joins
`job-application-review`, alongside a safe public metadata contract
(`WorkspacePublicMetadata`: `id`/`displayName`/`description` only — never
instructions) kept deliberately separate from `WorkspaceDefinition`.
`GET /v1/workspaces` lists both, deterministically ordered, excluding the
internal-only Echo workspace; `POST /v1/runs` is unchanged. The React client
became a generic, catalog-driven runner (workspace selector, per-workspace
copy, switch-safety invariants) instead of a client hardcoded to one
workspace — proving Agent OS is a genuine multi-workspace platform. See
[docs/reviews/M4_ARCHITECTURE_REVIEW.md](reviews/M4_ARCHITECTURE_REVIEW.md)
— **VALIDATED**.

## Next

### M5 — Run Records, Local Persistence, and History

**Goal:** give Agent OS local run identity, persistence, and history —
every successful run is durably saved (`id`, `workspaceId`, `input`,
`output`, `createdAt`) so a user can revisit past output without
re-running, without touching the validated
`executeWorkspace`/`AIProvider`/`WorkspaceDefinition` boundaries.
`POST /v1/runs`'s success response gains `runId`/`persisted`; its request
body is unchanged.

**Likely included scope:**

- A transport-neutral `RunStore` port with an `InMemoryRunStore` (tests)
  and a `SqliteRunStore` adapter using Node 24's built-in `node:sqlite` —
  no new dependency.
- Only successful runs are persisted; a provider failure creates no
  record, and a persistence failure never discards a successfully
  generated output (`persisted: false`, output still returned, HTTP `200`).
- `GET /v1/runs`, `GET /v1/runs/:id`, `DELETE /v1/runs/:id`, with safe,
  minimal shapes — list entries never carry full input/output.
- A small history view in the React client (list, detail, permanent
  delete) as local view state — no new router, dependency, or UI framework.
- Explicit local-only privacy documentation: single-user, no encryption at
  rest, not suitable for shared/production use without authentication and
  storage hardening.

**Explicitly excluded from M5:** authentication, multiple users, cloud
sync, sharing, search, filters, pagination, tags, folders, editing saved
runs, rerunning history, failed-run persistence, provider/model metadata,
prompt/instruction persistence, prompt versioning, tools, memory,
multi-agent planning, deployment, PostgreSQL, encryption claims.

**Important framing:** persistence improves durability and makes Agent OS
feel like a real tool rather than a disposable chat session, but it is
**not by itself** the final differentiation from general-purpose products
like ChatGPT or Claude, which already let a user scroll back through past
conversations. The differentiating bet is repeatable, controlled,
tool-backed workflows (see M6 below); M5 is infrastructure toward that, not
the destination.

See [docs/milestones/M5_DESIGN.md](milestones/M5_DESIGN.md) for the full
design (RunRecord/RunStore shape, SQLite adapter, HTTP contracts, and
frontend approach), confirmed from source, not assumption.

M5 is not implemented by this document.

## Provisional (beyond M5)

Real candidates for future milestones, not yet scoped or scheduled. None of
these should be treated as committed work until a design doc for the
specific milestone exists:

- **M6 — first tool-backed workflow (likely direction).** The most
  plausible next differentiator: give one workspace a real tool call, not
  just a text-in/text-out prompt, proving Agent OS can run controlled,
  repeatable work beyond conversation — the core bet named in
  [Vision.md](Vision.md). Scope (which tool, which workspace, what
  execution/approval model) is undecided until M5 closes and its own
  design pass happens.
- **Authentication and deployment** — still out of scope through M5;
  required before any shared/production use of run history.
- **Evaluation/quality tooling** — systematic checking of workspace output
  quality (beyond the existing Fake-provider integration tests) — no
  concrete consumer yet.
- **Production hardening** — encryption at rest, multi-user storage,
  backup/restore for run history — only justified once a real deployment
  target exists.
- **Prompt/workspace management** — editing, versioning, or authoring
  workspaces at runtime — beyond the current compile-time `{ id,
  instructions }` shape.
- **Additional AI providers** — only the Anthropic/Fake boundary exists; a
  third provider remains hypothetical.

## Explicitly deferred (not on this roadmap yet)

- Distributed or multi-node execution.
- A plugin or third-party extension system.
- Client-selected AI provider/model configuration (server-owned by design,
  validated in M1 — not expected to change).
- Memory and multi-agent planning.
- Dynamic workspace plugin loading and user-created workspaces.
- Authentication, multi-user support, and cloud sync (also explicit M5
  exclusions above).
