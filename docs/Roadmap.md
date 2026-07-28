# Roadmap

Status: M0 through M3 are complete, reviewed, and merged to `main`. A
post-M3 live-Anthropic validation checkpoint has also been completed
manually. M4 is defined below as the recommended next milestone; everything
after M4 remains provisional or explicitly deferred, per
[Architecture.md](Architecture.md) and [PROJECT_RULES.md](PROJECT_RULES.md).

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

## Next

### M4 — Workspace Catalog and Second User-Facing Workspace

**Goal:** move the web client from one hardcoded workspace toward a generic
workspace runner, while preserving `POST /v1/runs` exactly as M0–M3 built it
— no change to `executeWorkspace`, the `AIProvider` port, or the
request/response contract's core shape. A selector is only meaningful once
the catalog holds at least two genuine user-facing workspaces, so M4 adds
the second one rather than shipping a selector over a catalog of one.

**Likely included scope:**

- `job-application-review` remains the first user-facing workspace,
  unchanged in behavior.
- Exactly one second, meaningful user-facing workspace, selected during M4
  design — not a placeholder.
- Echo remains an internal developer/reference workspace and is **not**
  shown in the user-facing catalog.
- A safe public workspace metadata contract (e.g. id + display
  name/description) that must not expose instructions or internal config.
  `WorkspaceDefinition` is not automatically extended to carry this — M4
  design must evaluate whether public metadata belongs in a separate type
  instead.
- A backend endpoint for listing the (catalog-eligible) available
  workspaces, built the same evidence-gated way as `POST /v1/runs` was.
- A workspace selector in the React client, replacing the hardcoded
  `WORKSPACE_ID` constant in `App.tsx`, making it a generic runner rather
  than one bound to `job-application-review`.

**Explicitly excluded from M4:**

- Persistence.
- Run history.
- Authentication.
- Tool calling.
- Memory.
- Multi-agent planning.
- Deployment.
- User-created workspaces.
- Dynamic plugin loading.
- Client-selected AI provider or model (provider selection stays
  server-owned, per M1's validated security/cost boundary).

A short `M4_DESIGN.md`, matching the pattern of M1–M3's design docs, is
expected before implementation begins, and should confirm from source
(not assumption) whatever new endpoint/contract shape it proposes.

M4 is not implemented by this document.

## Provisional (beyond M4)

Real candidates for future milestones, not yet scoped or scheduled. None of
these should be treated as committed work until a design doc for the
specific milestone exists:

- **Persistence and run history** — a generated run identifier and a store
  for past runs; first raised as an M1 option and deferred each milestone
  since, pending an actual consumer that needs to correlate runs.
- **Tool execution** — tool calling and tool-execution infrastructure,
  excluded from every milestone so far; would require its own design pass
  once a workspace genuinely needs it.
- **Authentication and deployment** — both explicitly out of scope through
  M4; production hosting of `apps/web` was already named as deferred in
  `docs/milestones/M3_DESIGN.md`.
- **Prompt/workspace management** — anything beyond the current
  compile-time `{ id, instructions }` shape (e.g. editing, versioning, or
  authoring workspaces at runtime) — only justified once M4's catalog work
  reveals a concrete need.
- **Additional AI providers** — only the Anthropic/Fake boundary has been
  built; a third provider remains purely hypothetical.

## Explicitly deferred (not on this roadmap yet)

- Distributed or multi-node execution.
- A plugin or third-party extension system.
- Client-selected AI provider/model configuration (server-owned by design,
  validated in M1 — not expected to change).
- Memory and multi-agent planning.
- Dynamic workspace plugin loading and user-created workspaces (also called
  out as explicit M4 exclusions above).
