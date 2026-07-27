# M1 Design — HTTP Application Boundary

Status: design only. No application code, dependency installs, or tests exist
yet for M1. This document is the implementation specification, in the same
role `M0_DESIGN.md` played for M0. It complies with
[../Vision.md](../Vision.md), [../Architecture.md](../Architecture.md),
[../Roadmap.md](../Roadmap.md), [../PROJECT_RULES.md](../PROJECT_RULES.md),
[../milestones/M0_DESIGN.md](M0_DESIGN.md),
[../reviews/M0_ARCHITECTURE_REVIEW.md](../reviews/M0_ARCHITECTURE_REVIEW.md),
[../adr/0001-provider-neutral-ai-provider-port.md](../adr/0001-provider-neutral-ai-provider-port.md),
and
[../adr/0002-agent-os-error-ownership.md](../adr/0002-agent-os-error-ownership.md).
No conflicts were found among these documents during design.

## 1. Purpose

M1 must prove: **an HTTP input adapter can invoke the existing
`executeWorkspace` use case without requiring changes to**:

- `src/application/executeWorkspace.ts`
- `src/providers/AIProvider.ts`
- `src/errors/AgentOsError.ts`

The intended path:

```
HTTP request
  → HTTP validation and DTO mapping
  → executeWorkspace
  → workspace resolution
  → AIProvider
  → normalized result
  → safe HTTP response
```

This mirrors the CLI's already-validated path
(`docs/milestones/M0_DESIGN.md` Section 1) with the input/output adapter
swapped from CLI to HTTP — the exact test the M0 architecture review named
as the exclusive remaining "provisional/open" item worth resolving with new
code (`docs/reviews/M0_ARCHITECTURE_REVIEW.md`, Section 11).

M1 must **not** attempt to prove: frontend behavior, persistence,
authentication, tools, memory, streaming, or multiple workspaces. None of
these are needed to prove the one thing M1 exists to prove, and none are
included in scope (Section 2).

## 2. Exact M1 scope

### Included

- One Express application.
- One HTTP execution endpoint (`POST /v1/runs` — Section 3).
- Separate Express **app construction** (a factory, no listening) from the
  **network-listening entrypoint** (the composition root).
- Dependency injection of `AIProvider` and `resolveWorkspace` into the
  Express app factory — never imported concretely by the factory or route.
- Request validation at the HTTP boundary (Section 4).
- Safe success/error response DTOs (Section 3).
- Automated HTTP tests using `FakeAIProvider` and small test-local doubles
  (Section 6) only.
- No live Anthropic calls anywhere in the default automated path.
- Minimal GitHub Actions CI: `npm ci`, `npm run typecheck`, `npm test`, on
  Node 24. **CI is a quality gate for M1, not a second product feature** —
  it enforces that the above already-true properties stay true; it does not
  add new application behavior.

### Explicitly excluded

- React or any frontend.
- Authentication or authorization.
- SQLite/PostgreSQL.
- Persistence or run history.
- Run identifiers.
- Streaming/SSE/WebSockets.
- Tools.
- Memory.
- Prompt manager.
- Planner/reviewer.
- Multi-agent execution.
- A second workspace.
- Dynamic workspace discovery.
- A `shared/` package.
- Deployment.
- Docker.
- A logging framework.
- A configuration service.
- Provider selection supplied by an HTTP request.

If implementation reveals a need for any of the above, it is recorded as an
open question for a future milestone's review, not added ad hoc during M1 —
the same discipline M0 applied to itself.

## 3. HTTP contract

### Endpoint shape: comparison

| | **Option A: `POST /v1/runs`** | Option B: `POST /v1/workspaces/:workspaceId/runs` | Option C: `POST /v1/workspaces/:workspaceId/execute` |
|---|---|---|---|
| Resource/action semantics | "Run" is the resource being created; `workspaceId` is an attribute of that run — a plain, correct use of POST-to-a-collection | Treats "workspace" as the primary addressable resource with runs nested under it | Same nesting as B, but "execute" is a verb — an action-as-resource smell where a perfectly good noun ("run") already exists |
| Future compatibility | Adding `GET /v1/runs/:runId` later (once run identifiers/persistence exist, per a future milestone) is a pure addition, no URL restructuring | Adding global run lookup later requires a second, non-nested route anyway — B doesn't actually save future work | Same problem as B, plus the verb-based naming doesn't extend cleanly to a future `GET` |
| Is it overly generic? | No — scoped to exactly what M1 does, versioned, and doesn't imply anything about workspaces-as-resources | Implies a `GET /v1/workspaces` / `GET /v1/workspaces/:id` resource surface that doesn't exist and isn't planned | Same implication as B |
| Recommended | **Yes** | No | No |

**Decision: Option A — `POST /v1/runs`.**

- **Resource/action semantics:** a "run" (one execution of a workspace
  against some input) is the actual resource being created; `workspaceId` is
  data describing that run, not a URL hierarchy. Nothing about a workspace is
  independently addressable, listable, or paginated in M1 (there is exactly
  one, hardcoded), so nesting under `/workspaces/:id/` would imply a resource
  surface that isn't being built.
- **Future compatibility:** when run identifiers and persistence arrive in a
  later milestone, `GET /v1/runs/:runId` is a natural, additive extension of
  the same collection — no URL restructuring. Under Option B/C, adding global
  run lookup later would require a second, non-workspace-nested route
  anyway, so nesting doesn't actually save future work; it only commits to an
  unbuilt workspace-resource concept now.
- **Why the route is not overly generic:** `/v1/runs` is scoped to exactly
  the one thing M1 does — create/execute a run — with a versioned prefix
  that leaves room for non-breaking evolution without implying anything
  about auth, workspaces-as-resources, or other unbuilt concerns.
- **Why "run" now, before run identifiers/persistence exist:** the word
  "run" describes *what's happening* (one execution), independent of whether
  it's persisted or has an id — using it doesn't commit to persistence, it
  names the resource honestly. The alternative names (e.g., "execute" or
  "echo") are either vague or workspace-specific in ways that don't
  generalize. Consistent with this, **the M1 response deliberately does not
  include a `runId`** — inventing an id with no lookup or persistence behind
  it would be a dishonest API surface. This is a disclosed, deliberate
  asymmetry: the resource is named "run," but M1 exposes no way to look one
  up later. Run identifiers are explicitly excluded from M1 (Section 2) and
  deferred to a milestone that also adds the ability to use them.

### Request

```
POST /v1/runs
Content-Type: application/json

{
  "workspaceId": "echo",
  "input": "Hello"
}
```

Exactly these two fields, both required strings. The request **must not**
contain, and unknown fields are rejected (Section 4): `provider`, `model`,
an API key, tools, memory configuration, or any other execution option.
**Provider selection is a server-composition concern; the client cannot
control it** (Section 5).

### Response

Success (`200 OK`, `Content-Type: application/json`):

```json
{ "output": "Echo: Hello" }
```

Error (uniform shape across every non-2xx status,
`Content-Type: application/json`):

```json
{
  "error": {
    "code": "WORKSPACE_NOT_FOUND",
    "message": "No workspace found for id \"does-not-exist\".",
    "retryable": false
  }
}
```

Every error response uses this exact three-field envelope
(`code`/`message`/`retryable`), whether the underlying failure is an
`AgentOsError` (from `executeWorkspace` or a provider adapter) or a purely
transport-local failure (next subsection). `AgentOsError`-based responses
carry its own `code`/`message`/`retryable` unchanged — never `cause`.
Transport-local responses use their own fixed code/message pairs, always
with `retryable: false`.

### HTTP-local error contract

`AgentOsError` and `AgentOsErrorCode` (`src/errors/AgentOsError.ts`) are
**unchanged by M1** ([ADR 0002](../adr/0002-agent-os-error-ownership.md)).
Failures that occur purely at the HTTP transport boundary — before a
request could even reach `executeWorkspace` — are represented by a separate,
transport-local error code type, defined and used only inside `src/http/`:

```ts
// design sketch — not implemented in this task
type HttpErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "ROUTE_NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "UNEXPECTED";
```

Each code has one exact, fixed, safe message — never varied at runtime with
request content:

| Code | Message |
|---|---|
| `INVALID_JSON` | `"Request body must contain valid JSON."` |
| `VALIDATION_ERROR` | `"Request body must contain only workspaceId and input as strings."` |
| `UNSUPPORTED_MEDIA_TYPE` | `"Content-Type must be application/json."` |
| `PAYLOAD_TOO_LARGE` | `"Request body is too large."` |
| `ROUTE_NOT_FOUND` | `"Route not found."` |
| `METHOD_NOT_ALLOWED` | `"Method not allowed."` |
| `UNEXPECTED` | `"An unexpected error occurred."` |

All seven `HttpErrorCode` values have `retryable: false`. None of them ever
include a raw Zod error, a raw Express/body-parser error, a stack trace, a
`cause`, the request body itself, prompt content, an API key, or a provider
response body — the fixed messages above are the *entire* content of the
`message` field, never augmented with details from the actual failure.

### Status mapping

| HTTP status | Cases |
|---|---|
| 200 | success |
| 400 | `INVALID_JSON`, `VALIDATION_ERROR`, `INVALID_INPUT` |
| 404 | `WORKSPACE_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 405 | `METHOD_NOT_ALLOWED` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 502 | `PROVIDER_ERROR` |
| 503 | `PROVIDER_UNAVAILABLE` |
| 500 | `UNEXPECTED` |

**`PROVIDER_MISCONFIGURED` does not appear in this table.** Provider
misconfiguration is a startup/composition failure (Section 5) that must
prevent the server from ever calling `.listen()` — it is not a request-time
HTTP result. No HTTP status is defined for it because no HTTP request can
ever observe it; a misconfigured server never accepts a connection in the
first place.

For `METHOD_NOT_ALLOWED` (405), the response includes an `Allow: POST`
header.

**Why HTTP-layer validation and `executeWorkspace`'s own validation are
split this way:** the HTTP layer validates *shape* only — are the required
keys present, are they strings, are there no extra keys. It deliberately does
**not** re-implement "is this string empty" — that is exactly what
`executeWorkspace` already owns (`INVALID_INPUT`, per ADR 0002) and the HTTP
adapter passes the raw string straight through rather than duplicating that
check. This avoids two independent, potentially-drifting definitions of
"invalid input" existing in the same codebase.

**Public responses never include:** `cause`, a stack trace, a raw SDK error
body, an API key, prompt content, or a provider response body. This is
enforced by the HTTP error mapper (Section 6) reading only `code`/`message`/
`retryable` off an `AgentOsError` — the same discipline already validated
for the CLI (ADR 0002).

### Middleware and route ordering

The observable request-handling order is fixed. The exact implementation may
combine adjacent middleware functions when that improves clarity, but this
order and behavior must be preserved:

1. **Request media-type check** for `POST /v1/runs` — a request to this
   route with a `Content-Type` other than `application/json` is rejected as
   `UNSUPPORTED_MEDIA_TYPE` (415) before body parsing is attempted.
2. **`express.json({ limit: "16kb", strict: true })`** — parses the body. A
   body over 16kb is rejected as `PAYLOAD_TOO_LARGE` (413); malformed JSON is
   rejected as `INVALID_JSON` (400); `strict: true` rejects top-level JSON
   values that aren't objects/arrays.
3. **`POST /v1/runs`** — the route handler: Zod validation, then
   `executeWorkspace`, then response mapping.
4. **Explicit all-method fallback for `/v1/runs`** — any method other than
   `POST` on this path returns 405 `METHOD_NOT_ALLOWED` with an
   `Allow: POST` header.
5. **Unknown-route fallback** — any path not matched above returns 404
   `ROUTE_NOT_FOUND`.
6. **Final error-handling middleware** — catches anything steps 1–5 didn't
   (a body-parser error not already handled by step 2, or any exception
   thrown during step 3) and renders it safely, defaulting to 500
   `UNEXPECTED` for anything unrecognized.

## 4. Validation-library decision

**Decision: Zod.**

| Criterion | Explicit manual validation | Zod |
|---|---|---|
| One small request body (2 required string fields) | Adequate, but unknown-key rejection must be hand-written (enumerate allowed keys, diff against `Object.keys`) | `.strict()` rejects unknown keys natively, well-tested |
| Runtime untrusted JSON | This is genuinely the first such boundary in the project (see below) | Purpose-built for exactly this |
| Error-message control | Full control, but every message hand-written | Full control retained — Zod errors are mapped through the same `mapErrorToResponse` function, not surfaced raw |
| Future frontend/shared-schema possibility | N/A | Tempting to extract to a shared package — **explicitly not done in M1** (see below) |
| Dependency cost | None | One small, zero-dependency, TypeScript-native package |
| Avoiding speculative shared contracts | N/A | Schema stays local to `src/http/`, not promoted to `shared/` |

Architecture.md's own placement rule (restated in `M0_DESIGN.md` Section 3)
said a validation library should be reconsidered "once the HTTP transport API
introduces untrusted network input crossing a real process boundary." **M1 is
that milestone.** Unlike M0's CLI flags (four flat, trusted-enough,
locally-typed arguments), an HTTP request body is untrusted JSON from a
network client, and unknown-field rejection by hand is exactly the kind of
detail that's easy to get subtly wrong (forgetting a key, not handling
`null` vs. `undefined`, inconsistent messages) — a well-tested library
removes a class of bugs for one small, well-justified dependency. Zod's
inferred static type additionally collapses "the runtime check" and "the TS
type" into one declaration, removing a duplication/drift risk that hand-written
validation plus a separate `interface` would carry.

**Exact schema** (lives entirely in `src/http/runRequestSchema.ts`, not a
shared package):

```ts
// design sketch — not implemented in this task
import { z } from "zod";

export const RunRequestSchema = z
  .object({
    workspaceId: z.string(),
    input: z.string(),
  })
  .strict();

export type RunRequestBody = z.infer<typeof RunRequestSchema>;
```

`.strict()` rejects any key beyond `workspaceId`/`input` — this is exactly
what makes `provider`/`model`/etc. in a request body a `VALIDATION_ERROR`
(Section 3), not merely an ignored field. `z.string()` alone (no `.min(1)`)
is deliberate: emptiness is `executeWorkspace`'s concern, not the schema's
(above).

**No shared package is created for this schema merely because a frontend
might someday want it.** No frontend consumer exists yet (Section 2). If one
is ever built, extracting a shared contract is a decision for that
milestone, made with a real second consumer in hand — not a speculative one
now.

## 5. Provider composition and server configuration

**Requirements restated:** HTTP request data cannot select the provider; the
Express app factory receives `AIProvider` and `resolveWorkspace` as injected
dependencies; HTTP tests use `FakeAIProvider` or a small test-local double
(Section 6); the listening server entrypoint is the composition root; that
entrypoint may choose a provider through server-owned configuration only;
`executeWorkspace` remains unaware of Express and provider selection
(already true and unchanged, per Section 1).

### Decision: `AI_PROVIDER` is required, with no default

This revises the earlier draft of this decision: `AI_PROVIDER` is not merely
explicit — it is **required**. There is no implicit default of any kind,
including no implicit default of `fake`. **Every earlier statement in this
document's history that `fake` is the implicit server default is superseded
by this section.**

| | A. Fake provider only for M1 | **B (revised). Explicit, required server env var — no default** | C. Anthropic whenever `ANTHROPIC_API_KEY` exists |
|---|---|---|---|
| Can the server ever use the real adapter? | No — forecloses it entirely for no reason in scope | Yes, when explicitly configured | Yes, but implicitly |
| Surprising implicit behavior? | No, but at the cost of never proving the HTTP path with a real-provider configuration | **No** — nothing is implicit; an operator must state intent | **Yes** — a leftover key silently switches behavior |
| What happens if configuration is simply forgotten? | N/A (only one behavior exists) | **Server refuses to start; the mistake is loud and immediate** | Server silently runs against whichever provider incidental environment state implies |

**Decision: revised Option B — `AI_PROVIDER` is required; there is no
default.** Startup behavior, checked once at process startup, before
`app.listen()`:

| Condition | Behavior |
|---|---|
| `AI_PROVIDER` is missing (unset) | Fail before listen: safe configuration message to stderr, nonzero exit code |
| `AI_PROVIDER` is set to anything other than `fake` or `anthropic` | Fail before listen: safe configuration message to stderr, nonzero exit code |
| `AI_PROVIDER=fake` | Construct `FakeAIProvider` |
| `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` missing or blank | Fail before listen: safe configuration message to stderr, nonzero exit code |
| `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` present | Dynamically import and construct `AnthropicAIProvider` (same lazy, gated pattern the CLI already uses) |

The HTTP request can never select or override any of this — Section 3's
request shape has no field for it, and `.strict()` rejects one if a client
tries anyway (test matrix, Section 9).

**Why requiring an explicit value is safer than silently defaulting to
`fake` when configuration is forgotten:** a silent default hides a real
operational mistake behind behavior that still looks like it's working. If a
deployment meant to run against the real Anthropic API forgot to set
`AI_PROVIDER`, a default-to-`fake` server would come up, accept traffic, and
return plausible-looking canned text indefinitely — the mistake could go
unnoticed for a long time, because nothing ever fails loudly. Requiring the
value with no default means a forgotten or mistyped configuration is caught
immediately, at startup, the same moment it's wrong — not discovered later
by a confused caller wondering why every response looks like `"Echo: ..."` in
production. This is a stricter posture than M0's CLI (where `--provider` had
a safe default appropriate to a one-shot local invocation) specifically
because a long-lived server is exactly the context where a silent
misconfiguration has the most room to go unnoticed.

### Exact server configuration

| Variable | Required? | Values | Notes |
|---|---|---|---|
| `AI_PROVIDER` | **Yes, no default** | `fake` or `anthropic` | Checked at startup, before `app.listen()` |
| `ANTHROPIC_API_KEY` | Only when `AI_PROVIDER=anthropic` | non-blank string | Same requirement the CLI already has |
| `PORT` | No | integer, 1–65535 | Defaults to `3000`; validated as an in-range integer before `app.listen()` — an out-of-range or non-numeric `PORT` fails startup the same way a bad `AI_PROVIDER` does |

**Host:** the server binds to `127.0.0.1` (loopback only) for M1. **No
`HOST` configuration variable is introduced** — the bind address is not
configurable in M1, since nothing in scope (Section 2) requires the server
to be reachable from anywhere but the local machine running it (or its own
test suite).

No `Config` service and no environment-variable validation library are
introduced — three variables, each checked with a plain, direct
comparison/parse in `server.ts`, is not a case that benefits from a library;
this mirrors the CLI's existing minimal, inline `process.env`-reading
precedent.

### Package scripts

```json
{
  "start": "node --env-file-if-exists=.env --import=tsx src/http/server.ts",
  "dev": "node --env-file-if-exists=.env --watch --import=tsx src/http/server.ts"
}
```

(Full script list, including unchanged M0 scripts, in Section 8.) Both load
`.env` the same way `smoke:anthropic` already does — via Node's own
`--env-file-if-exists`, so a missing `.env` never crashes the process before
`server.ts`'s own `AI_PROVIDER`/`ANTHROPIC_API_KEY`/`PORT` checks run. `dev`
additionally passes `--watch` (a Node flag, no new dependency) so the
long-lived server restarts on file changes during development.

### Implementation-time file updates (not made in this design task)

Two existing files need updates during implementation — listed here as
planned changes, not made now:

**`.env.example`** — planned shape:
```
AI_PROVIDER=fake
ANTHROPIC_API_KEY=
PORT=3000
```

**`README.md`** — planned additions: how to start the HTTP server against
the fake provider (`AI_PROVIDER=fake npm run start`, since there is no
default); how to explicitly select Anthropic (`AI_PROVIDER=anthropic` plus a
key); an explicit statement that no provider can be selected by HTTP request
data; that the live Anthropic path remains optional and requires a key; and
a `POST /v1/runs` request example matching Section 3.

## 6. Express structure

Five single-purpose production files, not one `server.ts` and not
fragmented further:

- **App factory** (`src/http/createApp.ts`) — builds and returns a
  configured `express.Application` given `{ resolveWorkspace, aiProvider }`.
  Registers the media-type check, JSON body parsing, the one route, the
  method/route fallbacks, and the final error-handling middleware (Section
  3's ordering). Never calls `.listen()`.
- **Route/controller** (`src/http/runsRoute.ts`) — the `POST /v1/runs`
  handler: parses the body via the schema, calls `executeWorkspace`, hands
  the result to the error mapper for non-success cases. Thin — no business
  logic beyond this mapping.
- **Request validator/schema** (`src/http/runRequestSchema.ts`) — the Zod
  schema plus a small parse helper (Section 4).
- **HTTP error/status mapper** (`src/http/mapErrorToResponse.ts`) — one pure
  function: `AgentOsError | HttpErrorCode → { status, body }`. Single source
  of truth for the Section 3 status table.
- **Server-listening composition root** (`src/http/server.ts`) — reads
  `AI_PROVIDER`/`ANTHROPIC_API_KEY`/`PORT`, fails fast if misconfigured
  (Section 5), constructs the real dependencies, calls the app factory,
  calls `app.listen(port, "127.0.0.1")`. The only file that touches
  `process.env` or `.listen()`.

All five files live flat under `src/http/` — no `routes/`/`controllers/`
subdirectory for a single route; that structure would earn its keep only
once there is more than one route to organize, which is explicitly out of
scope for M1.

### Test approach comparison

| | Supertest against the app object | Ephemeral real server + `fetch` | Direct handler unit tests |
|---|---|---|---|
| Exercises real Express middleware/routing/error-handling | **Yes** — drives requests through the actual app instance | Yes, plus real sockets | No — requires hand-constructing fake `req`/`res`, reimplementing what Express already does |
| Network/port overhead, flakiness risk | None | Port allocation, listen/close lifecycle, potential conflicts | None |
| Meaningfully more confidence than Supertest for M1's scope (no streaming)? | — | No — nothing in M1 needs a real socket | — |

**Decision: Supertest against the Express app object**, as the primary
approach for `createApp.test.ts`. It satisfies the requirement to exercise
real middleware behavior (body-parsing, routing, error-handling middleware
all actually run) without any real network/port management. **A
loopback-only ephemeral server is not necessary for this purpose** — it
would only earn its keep for something Supertest cannot simulate in-process,
such as real streaming/SSE or WebSocket upgrades or genuine
concurrent-connection behavior, none of which are in scope (Section 2).
Direct handler unit tests are rejected as the primary approach because they
would not exercise Express's own request-handling at all.

A real, listening process *is* still used, but for a different purpose —
verifying `server.ts`'s own startup behavior, which Supertest cannot observe
because it never calls `.listen()`. That is the subject of the next
subsection.

### Server startup testability

`src/http/server.ts` remains the listening composition root — the only file
that calls `app.listen()`. **A unit test must never import `server.ts`
directly**, because merely importing a module that calls `.listen()` at
startup would trigger a real listening server as a side effect of importing
it in a test process — exactly the kind of accidental behavior this design
avoids.

Instead, `src/http/server.e2e.test.ts` spawns the server as a real child
process — the same pattern M0 already validated for the CLI
(`src/cli/index.e2e.test.ts`) — and asserts on its exit code and stderr for
the three fail-before-listen scenarios (Section 5):

1. `AI_PROVIDER` unset → nonzero exit, safe stderr message, before listen.
2. `AI_PROVIDER` set to an unsupported value → nonzero exit, safe stderr
   message, before listen.
3. `AI_PROVIDER=anthropic` with no `ANTHROPIC_API_KEY` → nonzero exit, safe
   stderr message, before listen.

No live Anthropic request occurs in any of these — all three fail before a
provider is ever constructed. A successful fake-provider server start
(`AI_PROVIDER=fake`, actually listening and serving one request) is
validated **manually** during local validation (Section 11, checkpoint 10)
— starting it on the configured port, issuing one local request, then
terminating it — rather than as an automated test, since Supertest
(above) already covers real request-handling and `server.e2e.test.ts` only
needs to cover the fail-fast paths, where the process exits on its own
without ever needing to be torn down.

No broad server-configuration module is introduced solely to make this
testable — the three environment-variable checks live directly in
`server.ts`, and the e2e test simply spawns the real file with different
environments, the same way the CLI's own e2e test already does.

### Test-local provider doubles (no production `FakeAIProvider` changes)

M1 must not modify `src/providers/FakeAIProvider.ts` or
`src/providers/FakeAIProvider.test.ts`. Existing `FakeAIProvider` modes
already cover two of the four provider-facing HTTP test cases:

- `new FakeAIProvider()` (default success) → the HTTP success test.
- `new FakeAIProvider({ behavior: "failure" })` → the `PROVIDER_ERROR`/502
  test.

The remaining two cases use a small, test-local `AIProvider` double, defined
directly in `createApp.test.ts` (or a tiny same-directory test helper only
if duplication genuinely requires one — not a new production abstraction):

- A double whose `generate()` resolves
  `{ ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "...", retryable: true } }`
  — for the 503 test.
- A double whose `generate()` throws — for the `UNEXPECTED`/500 test.

Both satisfy the `AIProvider` interface directly (per
[ADR 0001](../adr/0001-provider-neutral-ai-provider-port.md)); neither is a
production file, neither is exported from `src/providers/`, and neither
requires touching any existing M0 source or test file.

## 7. Proposed file tree

Preserving every existing M0 file **unchanged, including
`src/providers/FakeAIProvider.ts` and `src/providers/FakeAIProvider.test.ts`**
(Section 6 supersedes any earlier proposal to extend them). Adding only:

```
.github/
└── workflows/
    └── ci.yml                        # GitHub Actions: npm ci, typecheck, test (network-free) on Node 24 — no application behavior

src/
└── http/
    ├── createApp.ts                  # Express app factory: takes {resolveWorkspace, aiProvider}, wires media-type check + body parsing + route + fallbacks + error handling; never listens
    ├── createApp.test.ts             # Supertest HTTP tests against the app factory, using FakeAIProvider and test-local doubles only
    ├── runsRoute.ts                  # POST /v1/runs handler: validate → executeWorkspace → map result to a response
    ├── runRequestSchema.ts           # Zod schema + parse helper for the run request body
    ├── mapErrorToResponse.ts         # Pure function: AgentOsError | HttpErrorCode → {status, body}
    ├── mapErrorToResponse.test.ts    # Unit tests for the status-mapping table itself, exhaustive over every code
    ├── server.ts                     # Composition root: reads AI_PROVIDER/ANTHROPIC_API_KEY/PORT, fails fast if misconfigured, builds real deps, calls createApp + app.listen()
    └── server.e2e.test.ts            # Spawns server.ts as a child process; verifies the three fail-before-listen configuration scenarios
```

`docs/adr/0001-provider-neutral-ai-provider-port.md`,
`docs/adr/0002-agent-os-error-ownership.md`, and
`docs/milestones/M1_DESIGN.md` are the three documents this task revises.

**May also be modified during implementation** (not modified in this design
task):
- `package.json`, `package-lock.json` — new dependencies and scripts
  (Section 8).
- `.env.example` — `AI_PROVIDER`/`ANTHROPIC_API_KEY`/`PORT` (Section 5).
- `README.md` — HTTP usage documentation (Section 5).

**Must not be proposed for change:**
- `src/application/**`, `src/cli/**`, `src/errors/**`, `src/providers/**`,
  `src/workspaces/**` — all existing M0 source and test files, byte-for-byte.
- `docs/milestones/M0_DESIGN.md`, `docs/reviews/M0_ARCHITECTURE_REVIEW.md`.

No `frontend/`, `backend/`, `shared/`, `packages/`, `controllers/`,
`services/`, `managers/`, `utils/`, `helpers/`, config-service file, or
logger-abstraction file is created. `routes/` is not introduced as a
directory since there is exactly one route file, kept flat in `src/http/`
alongside its siblings.

## 8. Dependencies and scripts

### New dependencies

| Dependency | Type | M1 use | Built-in alternative considered | Why insufficient |
|---|---|---|---|---|
| `express` | runtime | The HTTP application itself: routing, JSON body parsing, middleware composition | Node's `http.createServer` | No routing, no JSON body parsing, no middleware composition — would mean reimplementing Express poorly for one route; Express is already the framework named in Vision.md/README |
| `@types/express` | dev, **conditional** | TypeScript types for Express | — | Install only if the selected Express version does not already bundle compatible TypeScript declarations (Section 14) — an implementation-time check, not an architectural decision |
| `zod` | runtime | Request-body validation (Section 4) | Hand-written `typeof`/`Object.keys` checks | Considered and rejected in Section 4 — this is the first genuinely untrusted-network-input boundary, and unknown-key rejection plus type/runtime duplication are exactly where hand-written checks are error-prone |
| `supertest` | dev | HTTP test driver against the Express app object (Section 6) | Raw `fetch` against a real listening server | Considered and rejected in Section 6 — adds port/socket lifecycle management for no additional confidence at M1's scope |
| `@types/supertest` | dev, **conditional** | TypeScript types for `supertest` | — | Same conditional reasoning as `@types/express` |

No dependency-injection framework, no ORM, no additional test framework, and
no bundler are added — all correctly excluded per Section 2 and consistent
with M0's dependency discipline (`M0_DESIGN.md` Section 11).

### Proposed package scripts

```json
{
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "agent": "tsx src/cli/index.ts",
  "smoke:anthropic": "node --env-file-if-exists=.env --import=tsx src/cli/index.ts --provider anthropic",
  "start": "node --env-file-if-exists=.env --import=tsx src/http/server.ts",
  "dev": "node --env-file-if-exists=.env --watch --import=tsx src/http/server.ts"
}
```

All existing M0 scripts (`typecheck` through `smoke:anthropic`) are
unchanged. `test` automatically picks up `src/http/**/*.test.ts` under
Vitest's existing default include glob — no config change needed, matching
M0's existing precedent. `start`/`dev` are explained in Section 5.

**No dependencies are installed in this design task.**

## 9. Test matrix

**Regression**

| # | Test | Level | Subject | Substitution | Expected |
|---|---|---|---|---|---|
| 1 | Existing M0 source/test files are byte-for-byte unchanged | structural/diff | `src/application/**`, `src/cli/**`, `src/errors/**`, `src/providers/**`, `src/workspaces/**` | none | identical to pre-M1 state |
| 2 | Existing 32 M0 tests pass unchanged | regression | full existing suite | none | 32/32 pass, zero modified |

**HTTP success**

| # | Test | Level | Subject | Substitution | Expected |
|---|---|---|---|---|---|
| 3 | Valid Echo request | HTTP/Supertest | `POST /v1/runs` via `createApp` | `FakeAIProvider` (default success) | 200, `{ output: "Echo: Hello" }`, `Content-Type: application/json` |

**Shape validation**

| # | Test | Level | Subject | Substitution | Expected |
|---|---|---|---|---|---|
| 4 | Missing body | HTTP/Supertest | `createApp` | `FakeAIProvider` | 400, `VALIDATION_ERROR` |
| 5 | Missing `workspaceId` | HTTP/Supertest | `createApp` | `FakeAIProvider` | 400, `VALIDATION_ERROR` |
| 6 | Missing `input` | HTTP/Supertest | `createApp` | `FakeAIProvider` | 400, `VALIDATION_ERROR` |
| 7 | Wrong field type (`input: 123`) | HTTP/Supertest | `createApp` | `FakeAIProvider` | 400, `VALIDATION_ERROR` |
| 8 | Unknown field(s) (e.g. `provider`, `model`) | HTTP/Supertest | `createApp` | `FakeAIProvider` | 400, `VALIDATION_ERROR` — proves provider/model cannot be client-selected |

**Input validation delegated to the application**

| # | Test | Level | Subject | Substitution | Expected |
|---|---|---|---|---|---|
| 9 | Empty `input` (`""`) | HTTP/Supertest | `createApp` | `FakeAIProvider` (spy: asserted never called) | 400, `INVALID_INPUT` |
| 10 | Whitespace-only `input` (`"   "`) | HTTP/Supertest | `createApp` | `FakeAIProvider` (spy: asserted never called) | 400, `INVALID_INPUT` |

**Parser/media behavior**

| # | Test | Level | Subject | Substitution | Expected |
|---|---|---|---|---|---|
| 11 | Malformed JSON body | HTTP/Supertest | `createApp` | `FakeAIProvider` | 400, `INVALID_JSON` |
| 12 | Unsupported `Content-Type` (e.g. `text/plain`) | HTTP/Supertest | `createApp` | `FakeAIProvider` | 415, `UNSUPPORTED_MEDIA_TYPE` |
| 13 | Body exceeding 16kb | HTTP/Supertest | `createApp` | `FakeAIProvider` | 413, `PAYLOAD_TOO_LARGE` |

**Application/provider mapping**

| # | Test | Level | Subject | Substitution | Expected |
|---|---|---|---|---|---|
| 14 | Unknown `workspaceId` | HTTP/Supertest | `createApp` | `FakeAIProvider` (spy: asserted never called) | 404, `WORKSPACE_NOT_FOUND` |
| 15 | Permanent provider failure | HTTP/Supertest | `createApp` | existing `FakeAIProvider({ behavior: "failure" })` | 502, `PROVIDER_ERROR`, `retryable: false` |
| 16 | Provider unavailable | HTTP/Supertest | `createApp` | test-local double resolving `PROVIDER_UNAVAILABLE` (Section 6) | 503, `PROVIDER_UNAVAILABLE`, `retryable: true` |
| 17 | Unexpected exception | HTTP/Supertest | `createApp` | test-local double whose `generate()` throws (Section 6) | 500, `UNEXPECTED`, no stack trace in body |

**Routing**

| # | Test | Level | Subject | Substitution | Expected |
|---|---|---|---|---|---|
| 18 | Unknown route | HTTP/Supertest | `createApp` | — | 404, `ROUTE_NOT_FOUND` |
| 19 | Unsupported method on `/v1/runs` (e.g. `GET`) | HTTP/Supertest | `createApp` | — | 405, `METHOD_NOT_ALLOWED`, `Allow: POST` header present |
| 20 | Correct `Content-Type` on success and error | HTTP/Supertest | `createApp` | — | `application/json` in both cases |

**Safety**

| # | Test | Level | Subject | Substitution | Expected |
|---|---|---|---|---|---|
| 21 | No response leaks unsafe detail | HTTP/Supertest | every error case above (4–19) | as above | body never contains `cause`, stack-trace-shaped text, an API key, a raw provider/parser body, or echoed prompt/input content |

**Composition startup (child-process)**

| # | Test | Level | Subject | Substitution | Expected |
|---|---|---|---|---|---|
| 22 | Missing `AI_PROVIDER` | e2e/child-process | `server.ts` (spawned) | none | nonzero exit before listen; safe stderr; no network request |
| 23 | Invalid `AI_PROVIDER` value | e2e/child-process | `server.ts` (spawned) | none | nonzero exit before listen; safe stderr; no network request |
| 24 | `AI_PROVIDER=anthropic`, no `ANTHROPIC_API_KEY` | e2e/child-process | `server.ts` (spawned) | none | nonzero exit before listen; safe stderr; no network request |

**Structural**

| # | Test | Level | Subject | Substitution | Expected |
|---|---|---|---|---|---|
| 25 | `src/http/*.ts` (non-test) contains no `@anthropic-ai/sdk` import | structural | `src/http/**` | — | `grep` returns no matches |
| 26 | A request body cannot select provider/model | structural (same evidence as #8) | `createApp` | — | rejected as `VALIDATION_ERROR` |
| 27 | `executeWorkspace.ts`, `AIProvider.ts`, `AgentOsError.ts`, `FakeAIProvider.ts`, and all existing M0 test files are unchanged | structural/diff | listed files | — | byte-for-byte identical (same as #1) |
| 28 | Default `npm test` requires no external network access or secret | structural | full `npm test` run | — | zero network access, mirrors M0's existing invariant |

**CI**

| # | Test | Level | Subject | Substitution | Expected |
|---|---|---|---|---|---|
| 29 | Workflow structure | manual/structural review | `.github/workflows/ci.yml` | — | targets Node 24; runs `npm ci`, typecheck, and test |
| 30 | Workflow scope | manual/structural review | `.github/workflows/ci.yml` | — | never invokes `smoke:anthropic`; adds no lint/coverage/deployment steps |

No snapshot tests are used, matching M0's existing convention.

## 10. Dependency direction

- `src/http/**` may depend on `executeWorkspace`, the `AIProvider` type, the
  `resolveWorkspace` function type, and `AgentOsError` (read-only, for
  mapping) — the same read-only relationship the CLI already has with these
  contracts.
- `src/http/**` must not import `@anthropic-ai/sdk`. Only `server.ts` may
  reach `AnthropicAIProvider` — via the same lazy, gated pattern the CLI
  already uses (`await import(...)` inside the `AI_PROVIDER === "anthropic"`
  branch, after the key-presence check).
- `createApp.ts` receives `AIProvider` and `resolveWorkspace` via factory
  parameters — it never imports a concrete adapter itself.
- `executeWorkspace.ts` must not import Express or any HTTP DTO — unchanged
  from M0; no new dependency is added to this file.
- `src/providers/**` must not import Express. `FakeAIProvider.ts` in
  particular is not modified at all by M1 (Section 6).
- `src/workspaces/**` must not import Express.
- `.github/workflows/ci.yml` contains no application behavior — only npm
  script invocations.
- HTTP DTOs (the Zod schema, response shapes) stay local to `src/http/**` in
  M1 — not extracted to a `shared/` package (Section 4).

**Circular dependency check:** `createApp.ts → runsRoute.ts →
executeWorkspace.ts, runRequestSchema.ts, mapErrorToResponse.ts`;
`mapErrorToResponse.ts → AgentOsError` (type only); `server.ts → createApp.ts,
resolveWorkspace.ts, FakeAIProvider.ts` (static) `+ AnthropicAIProvider.ts`
(dynamic, gated). `server.e2e.test.ts` spawns `server.ts` as a subprocess —
this is a runtime invocation, not a module import, so it introduces no
dependency-graph edge at all. Nothing downstream imports back upstream — the
same DAG shape M0 validated, extended by one new branch (`src/http/**`)
hanging off `executeWorkspace`/`AIProvider` exactly the way `src/cli/**`
already does. No cycle is introduced.

## 11. Implementation sequence

1. **Install only approved dependencies and add scripts** — `express`,
   `zod`, `supertest` (+ `@types/express`/`@types/supertest` only if needed,
   Section 14); add the `start`/`dev` scripts.
   *Validation:* `npm install` succeeds; `npm run typecheck` passes on an
   otherwise-unchanged tree.
2. **Add the HTTP-local error mapper and its tests** —
   `mapErrorToResponse.ts` + `mapErrorToResponse.test.ts`, exhaustive over
   all five `AgentOsErrorCode` values and all seven `HttpErrorCode` values.
   *Validation:* `mapErrorToResponse.test.ts` passes.
3. **Add the Zod request schema** — `runRequestSchema.ts`.
   *Validation:* covered by the HTTP-level tests in the next checkpoint
   (schema behavior is only meaningful through the route).
4. **Add the app factory and route, with success/validation tests** —
   `createApp.ts`, `runsRoute.ts`, `createApp.test.ts` covering test matrix
   items 3–10, 20.
   *Validation:* those tests pass.
5. **Add mapped provider/application failure tests**, using the existing
   `FakeAIProvider` failure mode and the test-local doubles (Section 6) —
   test matrix items 14–17, 21.
   *Validation:* those tests pass; no production file beyond `createApp.ts`/
   `runsRoute.ts` changes.
6. **Add route/method/media/parser/body-limit handling** — the media-type
   check, `express.json({ limit: "16kb", strict: true })`, the method
   fallback, and the unknown-route fallback (Section 3's ordering) — test
   matrix items 11–13, 18–19.
   *Validation:* those tests pass.
7. **Add the server composition root and its startup child-process tests**
   — `server.ts`, `server.e2e.test.ts` covering test matrix items 22–24.
   *Validation:* those tests pass; manual `AI_PROVIDER=fake npm run start`
   works and serves one real request (checkpoint 10 covers this more fully).
8. **Update `README.md` and `.env.example`** per Section 5's planned shapes.
   *Validation:* manual review against Section 5.
9. **Add the CI workflow** — `.github/workflows/ci.yml`.
   *Validation:* reviewed for syntactic correctness locally; full validation
   requires an actual push, which is out of scope for this design task.
10. **Run full final validation** — `npm run typecheck && npm test`, plus a
    manual HTTP smoke check (`curl`/`fetch`) against a locally started
    server (`AI_PROVIDER=fake`) — issue one real request, confirm the
    response, then terminate the process cleanly.

Checkpoints are validation boundaries, not necessarily commit boundaries.

**Recommended Git history:**

1. `docs: define M1 HTTP boundary`
2. `feat: add HTTP application boundary`
3. `ci: add network-free quality gate`
4. `docs: record M1 architecture findings`

**Why CI is a separate commit even though it is within the M1 milestone:**
CI configuration is process/infrastructure, not application behavior.
Keeping it separate lets a reviewer verify "does the HTTP feature work"
independently of "does the automation around it work," mirrors the M0
precedent of treating design/implementation/review as distinct,
independently-revertible units of history, and means that if the workflow
itself needs iteration later (wrong Node version, caching tweaks) that
iteration doesn't need to touch or re-litigate the feature commit.

No commits are created in this task.

## 12. Acceptance checklist

- [ ] `npm ci` completes cleanly
- [ ] `npm run typecheck` exits `0`
- [ ] All existing M0 source and test files remain byte-for-byte unchanged
      (`src/application/**`, `src/cli/**`, `src/errors/**`,
      `src/providers/**` — including `FakeAIProvider.ts` — and
      `src/workspaces/**`)
- [ ] All existing 32 M0 tests pass unchanged
- [ ] All new HTTP tests pass (test matrix, Section 9)
- [ ] No automated test requires a real API key, a real `.env` file, or
      network access
- [ ] Every HTTP error response body contains only `code`/`message`/
      `retryable` — never `cause`, a stack trace, an API key, a raw
      provider/parser body, or prompt content
- [ ] A request body containing `provider`, `model`, or any field beyond
      `workspaceId`/`input` is rejected with `VALIDATION_ERROR` (test matrix
      item 8) — the provider cannot be selected by request
- [ ] `PROVIDER_MISCONFIGURED` never appears in any HTTP response; it is
      exclusively a startup failure verified by `server.e2e.test.ts`
- [ ] `AI_PROVIDER` has no implicit default anywhere in the implementation —
      missing or unsupported values fail startup before `.listen()`
      (test matrix items 22–23)
- [ ] `413 PAYLOAD_TOO_LARGE` and `415 UNSUPPORTED_MEDIA_TYPE` are both
      implemented and tested (test matrix items 12–13)
- [ ] `405 METHOD_NOT_ALLOWED` responses include an `Allow: POST` header
      (test matrix item 19)
- [ ] No change to `src/application/executeWorkspace.ts`,
      `src/providers/AIProvider.ts`, or `src/errors/AgentOsError.ts`
- [ ] No change to `src/providers/FakeAIProvider.ts` or
      `src/providers/FakeAIProvider.test.ts`
- [ ] `start` and `dev` scripts both load `.env` via `--env-file-if-exists`
- [ ] `.env.example` and `README.md` updates match the planned shapes in
      Section 5 (implementation-time changes, not made in this design task)
- [ ] CI workflow passes on Node 24 (`npm ci`, typecheck, test only)
- [ ] No `shared/` package created
- [ ] No frontend code created
- [ ] No persistence code created
- [ ] No authentication/authorization code created
- [ ] No streaming/SSE/WebSocket code created
- [ ] `git diff --check` reports no whitespace errors on the implementation
      diff

## 13. Risks and open decisions

| Risk | Resolution |
|---|---|
| HTTP concerns leaking into application code | `executeWorkspace`/`AIProvider`/`AgentOsError` remain untouched (Section 1); `HttpErrorCode` values live entirely in `src/http/`, never added to `AgentOsErrorCode` (ADR 0002) |
| Overdesigning the API before a frontend exists | Exactly one endpoint, no query params, no pagination, no envelope beyond `{output}`/`{error}` (Section 3) |
| Premature shared DTO package | Explicitly resolved — no `shared/` package; DTOs local to `src/http/` (Section 4) |
| Overusing Zod for one small body | Schema is 2 flat string fields, `.strict()`, no nested objects, no speculative refinements (Section 4) |
| Manual validation becoming brittle | Resolved by choosing Zod instead (Section 4) — moot, but Zod itself is kept this thin, not extended speculatively |
| Provider-selection leakage | Enforced twice: `.strict()` rejects a `provider`/`model` field outright (test-covered, item 8), and `runsRoute.ts` never reads such a field even if it somehow arrived |
| Express app-factory complexity | Five small, single-responsibility files (Section 6), not merged into one file, not fragmented further |
| Testing only handlers rather than real middleware behavior | Resolved by choosing Supertest against the real app object (Section 6), which exercises body-parsing/routing/error-middleware |
| Scope creep into auth/persistence/run history | Explicitly excluded (Section 2, acceptance checklist); run identifiers deferred to a milestone that also adds the ability to use them (Section 3) |
| CI expanding into lint/coverage/deployment | Workflow contains exactly three steps (install, typecheck, test); explicitly stated as a quality gate, not a product feature (Section 2) |

**Resolved (previously open, now decided):**

- **`PORT` variable/default:** `PORT`, optional, defaults to `3000`,
  validated as an integer 1–65535 before `.listen()` (Section 5).
- **Server bind host:** `127.0.0.1` for M1; no `HOST` variable is introduced
  (Section 5).
- **`mapErrorToResponse.test.ts` placement:** a separate test file (Section
  7). This test-organization decision is resolved and not reconsidered.
- **Provider default behavior:** there is no default; `AI_PROVIDER` is
  required (Section 5).
- **Server startup-test approach:** child-process spawning via
  `server.e2e.test.ts` (Section 6), matching the CLI's existing e2e-test
  pattern.

**The only remaining, genuinely non-blocking open item:**

- Whether the selected Express and Supertest package versions bundle
  compatible TypeScript declarations. `@types/express`/`@types/supertest`
  are installed only if they do not (Section 14) — an implementation-time
  check, not an architectural decision, and it does not alter anything else
  in this document.

All other decisions in this document are resolved.

## 14. Self-audit

Audited against README.md, Vision.md, Architecture.md, Roadmap.md,
PROJECT_RULES.md, M0_DESIGN.md, the M0 architecture review, and both ADRs:

- **No claim that `AI_PROVIDER` defaults to `fake`:** removed and explicitly
  superseded (Section 5); the requirement is "no default" throughout.
- **`PROVIDER_MISCONFIGURED` is not in the HTTP status mapping:** removed
  from Section 3's table with an explicit explanation of why (it is a
  startup-only failure).
- **No proposed `FakeAIProvider` modification:** removed; Section 6 defines
  test-local doubles instead, and the file tree/acceptance checklist both
  state `FakeAIProvider.ts`/`FakeAIProvider.test.ts` are unchanged.
- **413 and 415 behavior are both present:** defined in Section 3's status
  table and middleware ordering, and covered by test matrix items 12–13.
- **HTTP-local error type and messages are fully defined:** `HttpErrorCode`
  (seven values) and their exact fixed messages are in Section 3.
- **Server scripts load `.env`:** `start` and `dev` both use
  `--env-file-if-exists=.env` (Section 5/8).
- **README and `.env.example` updates are included:** as an explicit,
  implementation-time file-change list (Section 5/7), not made in this
  design task.
- **`PORT`/host/test-layout decisions are resolved, not open:** confirmed in
  Section 13's "Resolved" list.
- **No unit test imports a side-effectful listening module:** Section 6
  explicitly states a unit test must never import `server.ts`; startup
  behavior is tested only via child-process spawning.
- **No claim that the type system enforces SDK import location:** ADR 0001
  now explicitly distinguishes type-system enforcement (the port's own
  declared shape) from architecture-rule/structural-audit enforcement
  (where the SDK import may appear) — this document's Section 10 describes
  the latter kind of rule accordingly.
- **No overly permanent one-file adapter rule:** ADR 0001 now phrases SDK
  confinement as "the Anthropic adapter boundary, currently implemented by"
  a named file, not a permanent single-file rule.
- **ADR 0001's "Section of ADR 0002" wording is fixed:** it now names the
  specific decision (provider-owned codes) and links to ADR 0002 directly.
- **No claim that `AgentOsErrorCode` can never evolve:** ADR 0002 now states
  explicitly that future additions are possible with concrete evidence and
  an ADR update/superseding ADR — not forbidden forever.
- **No change proposed to existing M0 source/tests:** Section 7's "must not
  be proposed for change" list is explicit and matches the acceptance
  checklist.
- **No scope creep into frontend/auth/persistence/streaming/shared
  packages:** unchanged from the prior draft — all remain explicitly
  excluded (Section 2).
