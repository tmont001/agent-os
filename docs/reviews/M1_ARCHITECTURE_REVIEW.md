# M1 Architecture Review — HTTP Application Boundary

Status: post-implementation review, conducted on branch `m1-http-adapter`
after commits `9ec8f23` (design) and `38ea87f` (feature — includes the CI
workflow; see Section 18 for the one minor deviation from the recommended
git history this represents). Evidence-based: every claim below is tied to a
specific file, test, or command re-run in this session, or explicitly marked
as user-confirmed external evidence.

## 1. Executive verdict

**VALIDATED WITH FOLLOW-UP.**

M1 accomplished its actual architectural purpose: a structurally different
input adapter (HTTP, with routing, headers, status codes, and untrusted
network input) was built on top of `executeWorkspace` with **zero bytes
changed** in `executeWorkspace.ts`, `AIProvider.ts`, `AgentOsError.ts`,
`FakeAIProvider.ts`, or any of the 32 existing M0 tests — confirmed by
`git diff` against those paths, not merely asserted. That is the specific
claim M1 existed to prove (M1_DESIGN.md Section 1), and it holds.

Not unconditionally "VALIDATED" because: the live Anthropic path was never
exercised over HTTP (deliberately, per instructions); `WorkspaceDefinition`
remains a single-data-point contract untouched by M1 (M0's oldest disclosed
open item, still open); and implementation surfaced one genuine platform
subtlety — on this system, Express's `listen()` callback can fire before an
asynchronous `EADDRINUSE` surfaces, meaning a "listening" stdout line can
legitimately precede a correctly-reported startup failure (Section 8). None
of these are defects, but they are real, disclosed limits on what "validated"
means here.

## 2. Goals and acceptance evidence

Evidence categories:
- **Automated local** — re-run and passing in this review session.
- **Manual local HTTP** — recorded in the implementation report (curl
  against a locally started server), not re-run in this review.
- **User-confirmed CI** — the user's statement that GitHub Actions passed
  for commit `38ea87f`, taken as given, not re-derived or fabricated.
- **Unvalidated live-Anthropic** — explicitly not run; listed only to say so.

| Criterion (M1_DESIGN.md Section 12) | Evidence | Result | Files/Tests |
|---|---|---|---|
| `npm ci` completes cleanly | Re-run this session (after clearing one unrelated stray filesystem artifact from `node_modules` — same class of issue as the M0 review, not a project defect) | Automated local — Pass | — |
| `npm run typecheck` exits 0 | Re-run, clean | Automated local — Pass | — |
| M0 source/tests byte-for-byte unchanged | `git status --short -- src/application src/cli src/errors src/providers src/workspaces` → empty | Automated local — Pass | — |
| 32 existing M0 tests pass unchanged | Present, unmodified, among the 80 | Automated local — Pass | all pre-existing `*.test.ts` |
| New HTTP tests pass | 48 new tests, all passing | Automated local — Pass | `createApp.test.ts` (26), `mapErrorToResponse.test.ts` (14), `server.e2e.test.ts` (8) |
| No automated test needs a real key/`.env`/network | Structural: `grep process\.env src/http` → only `server.ts` + `server.e2e.test.ts` (test scrubs keys before spawning) | Automated local — Pass | — |
| Error bodies contain only `code`/`message`/`retryable` | `PublicResponseCode` type + safety tests | Automated local — Pass | `mapErrorToResponse.ts`, safety tests in `createApp.test.ts` |
| `provider`/`model` rejected by request | `.strict()` schema + dedicated tests | Automated local — Pass | `createApp.test.ts` |
| `PROVIDER_MISCONFIGURED` never in an HTTP response | Type-excluded (`Exclude<AgentOsErrorCode, "PROVIDER_MISCONFIGURED">`) + fail-closed runtime guard + 2 dedicated tests + grep classification (12 matches, all comments/safe-tests) | Automated local — Pass | `mapErrorToResponse.ts`, `mapErrorToResponse.test.ts` |
| `AI_PROVIDER` has no implicit default | Missing/invalid-value child-process tests | Automated local — Pass | `server.e2e.test.ts` |
| 413/415 implemented and tested | Dedicated tests for both | Automated local — Pass | `createApp.test.ts` |
| 405 includes `Allow: POST` | Dedicated test | Automated local — Pass | `createApp.test.ts` |
| No change to the three protected M0 contracts | `git diff` empty on those exact files | Automated local — Pass | — |
| No change to `FakeAIProvider`/its test | `git diff` empty on those exact files | Automated local — Pass | — |
| `start`/`dev` load `.env` via `--env-file-if-exists` | `package.json` scripts read directly | Automated local (structural) — Pass | `package.json` |
| `.env.example`/README updated per plan | Read directly, match M1_DESIGN.md Section 5's planned shapes | Manual review — Pass | `.env.example`, `README.md` |
| CI passes on Node 24 | User-confirmed green GitHub Actions run for commit `38ea87f` | **User-confirmed CI** — Pass | `.github/workflows/ci.yml` |
| No `shared/`/frontend/persistence/auth/streaming | `find . -maxdepth 2 -type d` (this session) shows no such directories | Automated local — Pass | — |
| `git diff --check` clean | Re-run, clean | Automated local — Pass | — |
| Live Anthropic HTTP path works | Not run | **Unvalidated live-Anthropic** | — |

**No claim in this document treats the live Anthropic HTTP path as tested.**

## 3. Execution path proven

```
HTTP request
  → media-type/body parsing        src/http/createApp.ts (req.is("application/json"), express.json({limit:"16kb",strict:true}))
  → Zod validation                 src/http/runRequestSchema.ts, invoked in src/http/runsRoute.ts
  → executeWorkspace                src/application/executeWorkspace.ts — UNCHANGED from M0
  → workspace resolution            src/workspaces/resolveWorkspace.ts — UNCHANGED, injected
  → AIProvider                      src/providers/AIProvider.ts (port) — UNCHANGED; FakeAIProvider.ts UNCHANGED, AnthropicAIProvider.ts UNCHANGED
  → normalized result               src/http/mapErrorToResponse.ts (AgentOsError | HttpErrorCode → {status, body})
  → safe HTTP response              src/http/runsRoute.ts (res.status(...).json(...))
```

`src/http/server.ts` is the composition root that wires `resolveWorkspace` +
a concrete `AIProvider` into `createApp` and calls `.listen()` — it sits
outside this per-request path entirely (Section 8).

## 4. M0 boundary reuse

`executeWorkspace.ts`, `AIProvider.ts`, `AgentOsError.ts`, `FakeAIProvider.ts`,
`resolveWorkspace.ts`, and all 32 M0 tests are confirmed unchanged
(`git diff` against each path returns nothing). This is meaningful evidence,
not a formality: HTTP is a genuinely different transport from a CLI — it has
headers, status codes, a request body parsed from untrusted network bytes,
and concurrent-connection semantics a CLI never has. If the application
boundary had needed even a small change to accommodate any of that, it would
have falsified M0's central claim that `executeWorkspace` is transport-
agnostic. Building a full second input adapter with zero changes to the
reused files is the strongest evidence available for that claim short of a
third, differently-shaped adapter.

## 5. Dependency direction

- **HTTP adapter → application contracts:** `runsRoute.ts` imports
  `executeWorkspace`, the `AIProvider` type, and the `WorkspaceDefinition`
  type — never a concrete adapter. Confirmed by reading the file.
- **No Express leakage into application/providers/workspaces:** confirmed —
  those files are unchanged from M0 and were already grep-verified
  Express-free during the M0 review; nothing in this M1 diff touches them.
- **No Anthropic SDK import in HTTP request handling:**
  `grep -RIn '@anthropic-ai/sdk' src/http` returns exactly one match, a
  comment in `server.ts` — no actual import anywhere under `src/http`.
- **App factory vs. listening composition root:** `createApp.ts` contains no
  `process.env` reference and never calls `.listen()`; `server.ts` is the
  only file that does either. Confirmed by reading both.
- **HTTP DTOs local to `src/http`:** `RunRequestSchema`, `HttpErrorCode`, and
  `PublicResponseCode` are all defined inside `src/http/`; no `shared/`
  package exists.
- **Circular/reverse dependencies:** none found. Same DAG shape as M0,
  extended by one branch (`src/http/**`) hanging off `executeWorkspace`/
  `AIProvider` exactly the way `src/cli/**` already does.

## 6. HTTP contract

- **`POST /v1/runs`:** implemented exactly as designed; exercised by 26
  Supertest cases and, per the implementation report, a real manual `curl`
  request returning `{"output":"Echo: Hello"}`.
- **`workspaceId`/`input` shape:** enforced by `RunRequestSchema` (`z.object`
  + `.strict()`).
- **Strict unknown-field rejection:** tested directly (unknown `provider`
  and `model` fields both rejected with `VALIDATION_ERROR`).
- **`application/json` enforcement:** corrected during implementation from a
  substring check to Express's real media-type matcher
  (`req.is("application/json")`), empirically verified (in the
  implementation session) to accept `application/json` and
  `application/json; charset=utf-8` while rejecting `application/jsonp`,
  `text/application/json`, a missing Content-Type, and
  `application/vnd.api+json` — all six now have dedicated tests.
- **16kb limit:** `express.json({ limit: "16kb" })`, tested with a
  20,000-character oversized body → `413 PAYLOAD_TOO_LARGE`.
- **Empty-input ownership remains in `executeWorkspace`:** the Zod schema
  uses `z.string()` with no `.min(1)`; empty/whitespace-only input tests
  assert both the `400 INVALID_INPUT` result *and* that the provider double
  was never called, confirming validation happens before the provider
  boundary, in `executeWorkspace`, not in the HTTP layer.
- **Provider/model rejection:** covered above; also confirmed structurally
  (`grep 'provider\|model' src/http`, all matches classified as type
  imports, test-only variables, or the approved composition root).
- **Status-envelope consistency:** every non-2xx response uses
  `{ error: { code, message, retryable } }`, whether the source is an
  `AgentOsError` or a transport-local `HttpErrorCode` — confirmed by reading
  `mapErrorToResponse.ts`.
- **405 `Allow: POST`:** implemented (`res.set("Allow", "POST")`) and tested.

## 7. Error ownership and safety

- **Agent OS errors mapped, not broadened:** `mapAgentOsErrorToResponse`
  reads only `code`/`message`/`retryable` off the input error; it does not
  add fields.
- **`HttpErrorCode` remains transport-local:** a separate type from
  `AgentOsErrorCode`, never merged; ADR 0002 was updated (prior to this
  review) to state this explicitly.
- **`PROVIDER_MISCONFIGURED` remains startup-only:** enforced at the type
  level via `PublicResponseCode = HttpErrorCode | Exclude<AgentOsErrorCode, "PROVIDER_MISCONFIGURED">`,
  and at runtime via `isPublicAgentOsErrorCode`. `grep PROVIDER_MISCONFIGURED src/http`
  returns 12 matches, every one classified this session as either an
  explanatory comment or part of the two tests proving fail-closed
  behavior — none is a status-map entry or a response-producing branch.
- **Fail-closed mapping to `UNEXPECTED`:** tested directly (constructing a
  `PROVIDER_MISCONFIGURED` error and asserting the mapped response is
  `500 UNEXPECTED` with no trace of the original code or message).
- **Parser-error classification:** narrowed to exactly `entity.too.large` →
  `PAYLOAD_TOO_LARGE`, `entity.parse.failed` → `INVALID_JSON`, anything else
  → `UNEXPECTED`. Notably tested against a *naturally triggered* case (an
  invalid `charset` parameter, which body-parser itself classifies as
  `charset.unsupported`), confirmed to map to `500 UNEXPECTED` rather than
  being misclassified as `INVALID_JSON` — this is real evidence, not a
  hypothetical.
- **Safe listen failures:** `server.ts` captures the `http.Server` returned
  by `.listen()` and attaches an `error` listener that writes a fixed safe
  message and sets `process.exitCode = 1`, never exposing the raw Node error.
  Tested via a real port-conflict scenario (Section 8 covers the one
  ordering subtlety this test surfaced).
- **No causes/stacks/parser/provider/Zod/keys/prompts exposed:** multiple
  dedicated safety tests (in both `createApp.test.ts` and
  `mapErrorToResponse.test.ts`) assert the absence of each, all passing.

## 8. Server composition

- **`AI_PROVIDER` required, no default:** confirmed in `server.ts`'s
  `buildAiProvider`; tested (missing and unsupported-value cases both fail
  before listen).
- **Explicit `fake`/`anthropic` selection:** confirmed; no implicit
  inference from `ANTHROPIC_API_KEY` presence.
- **Anthropic key validation, including whitespace-only:** `apiKey.trim().length === 0`
  check, tested directly.
- **`PORT` validation:** integer-range check (1–65535), tested with a
  parameterized case for `0`, `65536`, and `abc`.
- **`127.0.0.1` binding:** `app.listen(port, "127.0.0.1", ...)`; the
  implementation report records a manual `lsof` check confirming the process
  bound only to loopback.
- **Dynamic Anthropic import:** gated behind `AI_PROVIDER === "anthropic"`
  and a present key; `grep '@anthropic-ai/sdk' src/http` shows no static
  import anywhere.
- **Fail-before-listen behavior:** true and tested for all configuration
  errors (missing/invalid `AI_PROVIDER`, missing/blank key, invalid `PORT`).
- **Child-process isolation:** `server.e2e.test.ts`'s base environment
  strips `AI_PROVIDER`, `ANTHROPIC_API_KEY`, and `PORT` before each spawn,
  confirmed by reading the destructuring at the top of the file.
- **Port-conflict handling — one disclosed subtlety:** the implementation
  correctly reports the failure (exit code exactly 1, safe stderr, no stack
  trace, no lingering process — all tested and passing), but an isolated
  reproduction during implementation confirmed that on this platform,
  Express's `listen()` callback can fire (printing the "listening" line)
  *before* the asynchronous `EADDRINUSE` error is detected. This is a real
  Node/OS ordering behavior, not a bug in this implementation's logic — the
  test for this specific case was correctly scoped to check only what the
  design required for it (exit status, signal, stderr, no stack trace), not
  a blanket "no stdout" assertion that would have been false on this
  platform for reasons outside the application's control.

## 9. Testing quality

**Strong evidence:** 80 tests total; Supertest exercises the real Express
middleware stack (media-type check, body parser, routing, error middleware)
rather than hand-rolled request/response mocks; test-local provider doubles
(`PROVIDER_UNAVAILABLE`, throwing) were used surgically instead of expanding
`FakeAIProvider`, keeping the one true production test double minimal; the
child-process tests exercise real process exit codes and stderr rather than
importing `server.ts` and risking a real listening side effect.

**Brittle or implementation-coupled:** the "unrecognized body-parser error"
test relies on body-parser's internal `charset.unsupported` type string — a
legitimate, naturally-triggerable scenario, but coupled to that library's
internal naming. If a future major version renamed this type, the test
would very likely still pass (a different, still-"unknown" type would still
map to `UNEXPECTED`), but the intended code path (the specific `else`
branch) could silently stop being the one exercised. Worth a one-line note
for a future maintainer, not a blocking issue now.

**Missing high-value test:** none identified as a real gap — the concern
one might expect here (exercising the `npm run start`/`--env-file-if-exists`
script wrapper itself) is reasonably covered by the CLI's own established
precedent plus the manual smoke test already recorded in the implementation
report.

**Should remain unchanged:** the Supertest-against-the-app-factory pattern;
the test-local-double approach (not extending `FakeAIProvider`); the
child-process isolation pattern for `server.ts`'s startup behavior.

## 10. CI review

`.github/workflows/ci.yml`: triggers on `push` and `pull_request`; uses
`actions/setup-node@v4` with `node-version: 24`; runs exactly `npm ci`,
`npm run typecheck`, `npm test`. No secrets, no live smoke command, no
deployment, lint, coverage, caching, or matrix expansion — confirmed by
reading the file directly (unchanged from the implementation session).

**The user-confirmed green GitHub Actions run for commit `38ea87f` is
recorded here as stated by the user** — this review does not invent a run
URL, run number, or any additional CI metadata beyond that confirmation.

## 11. Code-quality review

**`createApp.ts`** — Responsibility: app factory + middleware wiring, clearly
scoped. Naming: clear (`requireJsonContentType`, `classifyBodyParserError`).
Coupling: only to `mapErrorToResponse` and `runsRoute` — correct direction.
Type safety: `req.is()` used correctly; `BodyParserError` type guard is
narrowly scoped to what it actually checks (`.type` as a string). Error
behavior: the parser-error classification is now appropriately narrow
(post-correction). Testability: excellent (26 tests). Maintenance: the
middleware registration order encodes real Express routing semantics
(`app.post` before `app.all` before the catch-all `app.use`) that a future
reader must understand via Express's own model — already explained by an
in-code comment referencing the design's numbered ordering. Appropriately
sized — five focused functions in one file, not fragmented further.

**`runsRoute.ts`** — Thin and correct. The explicit `try/catch` forwarding to
`next(error)` is a deliberate, defensive choice rather than relying on
Express 5's implicit async-rejection handling — a good clarity call. No
concerns.

**`runRequestSchema.ts`** — Minimal, exactly as designed. Nothing to
critique.

**`mapErrorToResponse.ts`** — The strongest file added in this milestone.
`PublicResponseCode`'s type-level exclusion of `PROVIDER_MISCONFIGURED`
converts a "must never happen" runtime discipline into a compiler-checked
one everywhere the type is used directly, combined with a runtime
fail-closed guard (`isPublicAgentOsErrorCode`) for the one place
(`AgentOsError` itself, which still structurally allows all five codes)
where static exhaustiveness can't be proven at the call site. This is
careful, well-reasoned type design, not over-engineering — it uses
TypeScript's own `Exclude<>` utility rather than a hand-rolled abstraction.

**`server.ts`** — Composition root correctly scoped (sole owner of
`process.env`/`.listen()`). The `httpServer.on("error", ...)` addition is
minimal and correct. The one real subtlety — the listening-message/
async-error ordering quirk (Section 8) — is a disclosed platform behavior,
not a hidden defect.

**Blocking defects:** none found.

**Non-blocking improvements:** one could imagine delaying the "listening"
stdout message until some grace period confirms no immediate bind error,
but this would add real complexity (timers, races) to fix a cosmetic
log-ordering concern with zero effect on the actual exit code or safety
guarantees — not worth doing at M1's scope.

**Should remain unchanged:** the five-file structure; the
`PublicResponseCode` exclusion pattern; the test-local-double approach.

## 12. Technical debt

**Accepted and intentional:** loopback-only server; synchronous-only
`POST /v1/runs` (no streaming); no run identity; no persistence; no auth; no
deployment; minimal CI scope; no shared DTO package — all explicit M1
non-goals (M1_DESIGN.md Section 2), not shortcuts.

**Address next:** no live Anthropic HTTP smoke evidence — the same class of
gap M0 had for the CLI, and it should be closed once a key is available,
before relying on the HTTP+Anthropic combination in production. The
`WorkspaceDefinition` single-data-point concern (inherited from M0, untouched
by M1) remains the most load-bearing open item across both milestones.

**Remain deferred:** Express/Zod dependency cost (small, justified, no
evidence of a problem); the `npm allow-scripts` warning (pre-existing from
M0, unaffected by M1, still just unacknowledged rather than broken).

**Not actually debt:** no logging/config service, no persistence, no auth,
no deployment, no shared package — all deliberate scope decisions
documented in M1_DESIGN.md, not oversights.

## 13. Portfolio and interview assessment

**Now credible:** a real HTTP API with strict request validation, a
type-enforced public error-code boundary, a fail-closed safety net for a
"must never happen" condition, real child-process testing of process-level
startup failures, and a green CI pipeline. This reads as production-lineage
engineering discipline, not tutorial code.

**Still a walking skeleton:** one workspace, one provider pair, no auth, no
persistence, no deployment. Anyone exercising this API needs to understand
it's a foundation being deliberately built in small, evidence-gated steps —
not a finished product.

**Likely interview questions, with the answer the evidence supports:**
- *Why HTTP after CLI?* Cheapest way to prove the application boundary
  survives a second, structurally different input adapter before adding
  transport complexity.
- *Why preserve `executeWorkspace` unchanged?* That preservation *is* the
  thing M1 needed to prove — changing it to accommodate HTTP would have
  meant M0's abstraction wasn't real.
- *Why Zod now but not in M0?* Untrusted network input is a genuinely
  different risk profile than trusted CLI flags — Architecture.md's own
  placement rule named this exact trigger condition in advance.
- *Why is provider selection server-owned?* A client should never control
  which paid, external API a server call reaches — a security/cost boundary,
  not a style preference.
- *Why is `HttpErrorCode` separate from `AgentOsErrorCode`?* Keeps a
  transport concern out of the application's error taxonomy so the two can
  evolve independently — enforced by the type system, not just convention.
- *Why Supertest plus child-process tests, not one or the other?* Supertest
  exercises real Express middleware without socket overhead; only a real
  child process can test actual exit codes and process-level startup
  failure, which Supertest cannot observe.
- *Why no frontend, no shared package, no default `AI_PROVIDER`?* No second
  consumer exists yet for the first two; the third is a deliberate safety
  choice — a forgotten configuration should fail loudly at startup, not
  silently serve fake data.

## 14. Architecture decisions

| Decision | Status | Evidence | Consequence |
|---|---|---|---|
| HTTP adapter over unchanged use case | Validated | `git diff` empty on `executeWorkspace.ts` etc.; 80 tests pass | Future adapters/consumers can rely on this boundary with confidence |
| Express app factory | Validated | `createApp.ts`, 26 tests, no `process.env`/`.listen()` inside it | Reusable in future tests/composition without side effects |
| Listening composition root | Validated | `server.ts` sole owner of `process.env`/`.listen()`, tested via child process | Safe to extend configuration surface later without touching app logic |
| Zod at the HTTP boundary | Validated | `.strict()` schema + rejection tests | Confirms Architecture.md's placement rule was correctly applied here |
| `POST /v1/runs` | Validated | Implemented, tested, manually curled | Stable base for an additive future `GET /v1/runs/:id` |
| HTTP-local errors | Validated | `HttpErrorCode`, `PublicResponseCode` exclusion, dedicated tests | Clean, type-enforced separation from `AgentOsErrorCode` |
| Server-owned provider selection | Validated | Schema rejects `provider`/`model`; tests confirm | Security/cost boundary proven, not just asserted |
| Required `AI_PROVIDER` | Validated | Missing/invalid-value tests, no default anywhere in code | Forgotten configuration fails loudly instead of silently serving fake data |
| Loopback binding | Validated | Code + manual `lsof` evidence (implementation report) | Safe default for this development-stage server |
| Supertest | Validated | 26 tests exercising real middleware | Confirmed sufficient; no real-socket tests needed for M1's scope |
| Child-process startup tests | Validated | 8 tests, real process spawns, no side-effectful import | Correct pattern for testing process-level configuration failure |
| `shared/` package | Rejected (for now) | None created; no second consumer exists | Correctly deferred, not a gap |
| `WorkspaceDefinition` | Still open | Unchanged by M1; only Echo exists | M0's oldest open item remains open — M1 wasn't scoped to resolve it |
| Live Anthropic HTTP path | Still open | Deliberately not run | Real, disclosed gap |

## 15. M2 options

### Option A — A second, meaningful reference workspace
- **Value:** finally tests `WorkspaceDefinition` at n=2 — the single most
  load-bearing open item carried across both M0 and M1.
- **Reusable capability tested:** whether `resolveWorkspace`'s map-based
  lookup and `{ id, instructions }` actually generalize, or need to grow.
- **Scope:** one new workspace file + one map entry, exercised through both
  existing input adapters (CLI and HTTP) unchanged.
- **Explicit exclusions:** no dynamic workspace discovery, no per-workspace
  tool/model/memory configuration, no third workspace.
- **Risks:** temptation to add speculative fields (tools, model
  preferences) "while we're in there" — must be resisted unless the second
  workspace's actual content demonstrably needs them.
- **Why it should be next:** cheapest way to close the oldest disclosed open
  item in the project, and it composes with work already done (both
  adapters, unchanged) rather than requiring new architectural surface.

### Option B — Run identifiers and structured run results
- **Value:** implements the still-unimplemented "run-level identifiers" line
  from Architecture.md's ownership table.
- **Reusable capability tested:** whether a run-id concept fits into
  `ExecuteWorkspaceOutput`/the HTTP response without breaking the
  Result-union pattern.
- **Scope:** a generated id attached to input/output, surfaced by both the
  CLI and HTTP adapter.
- **Explicit exclusions:** no persistence, no run-history querying.
- **Risks:** easy to scope-creep into "now that we have an id, let's persist
  it."
- **Why it might not be next:** lower value standing alone than Option A;
  better paired with a real reason to correlate runs (e.g., once
  persistence is actually being considered) rather than done in isolation.

### Option C — Minimal HTTP request logging
- **Value:** nothing today gives an operator visibility into HTTP traffic.
- **Reusable capability tested:** none architectural — this is process
  hygiene, not a design boundary.
- **Scope:** minimal method/path/status/duration logging to stdout/stderr,
  no framework.
- **Explicit exclusions:** no log aggregation, no structured logging
  library, no prompt/PII logging.
- **Risks:** temptation to reach for a logging library prematurely —
  explicitly excluded already in M1_DESIGN.md.
- **Why it might not be next:** valuable but lower priority than closing the
  `WorkspaceDefinition` question; good as a small rider on a later
  milestone, not a milestone by itself.

Do not combine these into one milestone — see Section 16.

## 16. Recommended M2

**Goal:** prove the `WorkspaceDefinition` contract and `resolveWorkspace`'s
map-based lookup at two real workspaces, closing the oldest disclosed open
item from M0, exercised through both existing input adapters (CLI and HTTP)
without modifying either.

**Why this is the correct next learning step:** it is the single most
load-bearing unresolved decision remaining after two milestones, it is cheap
to test, and it requires no new architectural surface (no new adapter, no
new dependency, no new transport). Option B (run identifiers) is real but
lower-value in isolation and better deferred until there's an actual reason
to correlate runs; Option C (logging) is process hygiene, not an open
architectural question.

**Included work:** one new workspace definition and its map entry; verifying
resolution and execution through both the CLI and the HTTP adapter; a short,
explicit note recording whether `{ id, instructions }` needed to grow to
accommodate the second real workspace, or was confirmed sufficient as-is.

**Excluded work:** dynamic workspace discovery/registry, per-workspace
tool/model/memory configuration, a third workspace, run identifiers,
persistence, logging.

**Objective exit criteria:** the second workspace is resolvable and
executable via both the CLI and the HTTP adapter; all existing tests for the
first workspace (Echo) remain unchanged and passing; `WorkspaceDefinition`
is either confirmed sufficient as-is or extended with a documented,
evidence-backed justification — not a speculative field added "just in
case."

**Required design work before implementation:** a short `M2_DESIGN.md`
(expected to be much smaller than M0's or M1's) naming the second
workspace's actual content and purpose, and stating explicitly whether any
contract change to `WorkspaceDefinition` is anticipated before any code is
written.

M2 is not implemented in this task.

## 17. ADR recommendations

**ADR 0001 (provider-neutral `AIProvider` port):** does not need amendment.
M1's HTTP layer never touches the port itself — it depends on the same
`AIProvider` type the CLI already used, and the port's own file is
unchanged. Everything ADR 0001 states remains accurate.

**ADR 0002 (error ownership):** does not need further amendment beyond the
update already made prior to this implementation (which added the explicit
M1/HTTP clarifications — no new codes, transport-local types stay separate,
transports map rather than mutate). Re-reading it against the actual
implementation, it holds up exactly as written.

**A new decision that deserves its own ADR:** the `PublicResponseCode`
pattern — a transport's public error-code surface expressed as a type-level
union that *excludes* specific internal-only codes (here,
`PROVIDER_MISCONFIGURED`), backed by a runtime fail-closed guard for cases
static exhaustiveness can't reach. This is a genuinely new, evidence-backed
pattern (the correction pass that produced it, plus its two dedicated
tests) that would be reusable by any future transport, not just HTTP.
- Suggested title: "ADR 0003 — Transport-Local Error Codes and the Public
  Response-Code Boundary."
- Evidence: `mapErrorToResponse.ts`'s `PublicResponseCode` type and
  `isPublicAgentOsErrorCode` guard; the two fail-closed tests in
  `mapErrorToResponse.test.ts`.
- When to write: not urgent for the recommended M2 (Option A doesn't touch
  HTTP at all); write it once a second transport is actually being built and
  needs to reuse this pattern, or opportunistically whenever convenient
  before then.

No ADR files were created in this task.

## 18. M1 closeout checklist

- [x] Design committed (`9ec8f23 docs: define M1 HTTP boundary`)
- [x] Feature committed (`38ea87f feat: add HTTP application boundary`)
- [x] CI included in the feature commit — **note:** `.github/workflows/ci.yml`
      was committed as part of `38ea87f` rather than as the separate
      `ci: add network-free quality gate` commit M1_DESIGN.md recommended;
      a minor, non-blocking deviation from the design's stated git-history
      preference, not a functional issue (confirmed via `git show --stat 38ea87f`)
- [x] CI green (user-confirmed for commit `38ea87f`)
- [x] Clean installation (re-verified this session)
- [x] Type-check (clean)
- [x] 80 tests (all pass)
- [x] M0 unchanged (`git diff` empty on all five protected paths)
- [x] HTTP success (test + manual curl evidence)
- [x] HTTP validation/error safety (test matrix + dedicated safety tests)
- [x] Startup configuration (8 child-process tests)
- [x] No live Anthropic claim (correctly not claimed anywhere in this review
      or the implementation report)
- [x] Scope exclusions held (directory check: no frontend/shared/persistence/
      auth/streaming)
- [x] Architecture review completed (this document)

**Remaining blockers to closing M1 itself: none.** The two open items (live
Anthropic HTTP evidence, `WorkspaceDefinition`'s single-data-point status)
are disclosed follow-ups carried forward, not blockers to this milestone's
own scope.

## 19. Final recommendation

**M1 READY TO CLOSE WITH DOCUMENTED FOLLOW-UP.**

Follow-up items (tracked, not blocking): (1) run a live Anthropic smoke test
over the HTTP path once a real API key is available, before relying on that
combination in production; (2) the second-workspace work recommended as M2
(Section 16), which closes the project's oldest open architectural question.

**On merging:** yes, reasonable to merge once this review is approved. The
working tree is clean, both milestone commits are in place, `npm ci`/
typecheck/tests all pass reproducibly locally, and CI is confirmed green.
Neither open follow-up needs to gate the merge — the live-Anthropic check is
an out-of-band manual verification independent of what's in the tree, and
the `WorkspaceDefinition` question is explicitly scoped to a future
milestone, not to M1 itself.
