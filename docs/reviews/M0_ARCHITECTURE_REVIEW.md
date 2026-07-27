# M0 Architecture Review — Echo Walking Skeleton

Status: post-implementation review, conducted on branch `m0-echo-walking-skeleton`
after commits `8f836a5` (design) and `c709357` (implementation). This review is
evidence-based: every claim below is tied to a specific file, test, or command
run during this review session, not inferred from the design intent alone.

## 1. Executive verdict

**VALIDATED WITH FOLLOW-UP.**

M0 accomplished its actual architectural purpose, not merely "the code runs."
The specific claims Architecture.md and M0_DESIGN.md asked M0 to prove — a
provider-neutral port with two independently-working implementations, an
application use case with zero concrete adapter or I/O coupling, an error
model with a type-enforced ownership split, and a network-free default test
suite — are all backed by re-run, reproducible evidence gathered in this
session (Section 2–4).

It is not unconditionally "VALIDATED" because M0 itself, by design, left
several things as single-data-point or entirely unexercised: the
`WorkspaceDefinition` contract has only Echo to generalize from, the
kernel/runtime dependency direction question was deliberately not addressed at
all, and the real Anthropic API path has zero live evidence (the offline
adapter tests validate translation logic against a simulated-but-realistic
transport, not a live round-trip). None of these are defects — they are
exactly what Architecture.md and Roadmap.md said M0 would leave open — but
calling the milestone unconditionally "validated" would overstate what one
Echo workspace and zero live requests can actually prove. The follow-up items
are named explicitly in Sections 6, 13, and 14.

## 2. M0 goals and evidence

Evidence categories used below:
- **Automated** — a test that ran and passed in this review session.
- **Manual offline** — a command run by hand in this session, no network.
- **Unvalidated live-provider** — explicitly not run; listed only to say so.

### Roadmap.md — "M0 proves only"

| Criterion | Evidence | Result | Files |
|---|---|---|---|
| CLI can invoke one application use case with no other input adapter | 11 e2e tests spawn the real CLI process and assert on `executeWorkspace`'s effects | Automated — Pass | `src/cli/index.ts`, `src/cli/index.e2e.test.ts` |
| Workspace resolution is a real code path, including "unknown workspace" | Resolution + not-found both tested; `executeWorkspace` test asserts `generate` is never called on an unknown workspace | Automated — Pass | `src/workspaces/resolveWorkspace.ts`, `resolveWorkspace.test.ts`, `src/application/executeWorkspace.test.ts` |
| `AIProvider` port is genuinely provider-neutral, two working implementations | `AIProvider.ts` imports only `AgentOsError`; `FakeAIProvider` and `AnthropicAIProvider` both implement it independently, both fully tested | Automated — Pass | `src/providers/AIProvider.ts`, `FakeAIProvider.ts`, `AnthropicAIProvider.ts` + both `.test.ts` files |
| Provider failures normalized into Agent OS's own error shape before reaching the use case/CLI | `executeWorkspace` passes `AIProviderFailure` through unchanged (already normalized); CLI only ever reads `.code`/`.message` | Automated — Pass | `src/application/executeWorkspace.ts:52-54`, `src/cli/index.ts:13-16` |
| `AnthropicAIProvider`'s own translation verified offline, zero network, as part of default suite | 11 tests: request translation, response normalization (single + multi text block), 429/500/529/connection-failure → `PROVIDER_UNAVAILABLE`, 400/401/403 → `PROVIDER_ERROR`, safety | Automated — Pass | `src/providers/AnthropicAIProvider.test.ts` |
| Default automated path requires no network access and no secrets | `npm test` re-run this session: 32/32 pass; `AnthropicAIProvider.test.ts` uses injected fake `fetch`, never global `fetch` | Automated — Pass | full `npm test` output, this session |

### Roadmap.md — "M0 exit criteria"

| Criterion | Evidence | Result | Files/Commands |
|---|---|---|---|
| Clean dependency installation | `npm ci` re-run this session — succeeded (one unrelated stray filesystem artifact in `node_modules/@types` from a prior run had to be cleared first; not a project defect, see Section 6) | Manual offline — Pass | `npm ci` output, this session |
| Type-check passes | `tsc --noEmit` — clean, no output | Automated — Pass | `npm run typecheck` |
| Automated tests pass, no network required | 5 files, 32 tests, all pass | Automated — Pass | `npm test` |
| `FakeAIProvider` success-path test passes | — | Automated — Pass | `src/providers/FakeAIProvider.test.ts` |
| Provider-failure-translation-path test passes | — | Automated — Pass | `executeWorkspace.test.ts`, `AnthropicAIProvider.test.ts` |
| CLI invocation works end-to-end against `FakeAIProvider` | `npm run --silent agent -- --workspace echo --input "Hello"` → exit 0, stdout `Echo: Hello`, stderr empty | Manual offline — Pass | this session |
| Optional Anthropic smoke test documented, runnable manually | `smoke:anthropic` script exists, documented in README; **intentionally not executed with a real key** | Documented, **not executed** | `package.json`, README.md — **unvalidated live-provider evidence** |
| No frontend/persistence/tools/memory/planning added | `find . -maxdepth 2 -type d` shows only `.claude`, `docs`, `src`; no forbidden packages | Automated/structural — Pass | directory listing, this session |
| Short post-M0 architecture review written | This document | Pass | `docs/reviews/M0_ARCHITECTURE_REVIEW.md` |

### M0_DESIGN.md acceptance checklist (additional items not already covered above)

| Criterion | Evidence | Result |
|---|---|---|
| `AnthropicAIProvider.ts` is the only file importing `@anthropic-ai/sdk` | `grep -RIn '@anthropic-ai/sdk' src` → one match, in that file | Automated/structural — Pass |
| `AIProvider.ts` contains no Anthropic/SDK-specific reference | Read in full this session — imports only `AgentOsError` | Manual review — Pass |
| CLI dynamically imports `AnthropicAIProvider` exactly once, inside the anthropic branch | `grep -n 'AnthropicAIProvider' src/cli/index.ts` → one match, at the `await import(...)` line | Automated/structural — Pass |
| `maxRetries: 0` / `timeout: 30_000` explicit | Read in full — both literals present in the `Anthropic` client constructor call | Manual review — Pass |
| `ANTHROPIC_API_KEY` set, `--provider anthropic` selected without key → `PROVIDER_MISCONFIGURED`, no stack trace | `env -u ANTHROPIC_API_KEY npm run --silent agent -- ... --provider anthropic` → exit 1, one safe stderr line | Manual offline — Pass |
| `ANTHROPIC_MODEL` absent from configuration surface | repo-wide grep for `ANTHROPIC_MODEL` (excluding docs discussing its absence) → no configuration references | Automated/structural — Pass |
| Single npm package, no `packages/*` | `package.json` has no `workspaces` field; no `packages/` directory | Automated/structural — Pass |

**No claim in this document treats the live Anthropic API path as validated.**
The smoke test was not run, per instructions; every statement about
`AnthropicAIProvider` correctness above is scoped to its offline, injected-fetch
tests.

## 3. Execution path actually proven

```
CLI input adapter                    src/cli/index.ts (main())
  → executeWorkspace use case        src/application/executeWorkspace.ts, called at index.ts:86-89
  → workspace resolution              src/workspaces/resolveWorkspace.ts, invoked inside executeWorkspace.ts:35
                                       (received as an injected function, not imported concretely)
  → AIProvider port                   src/providers/AIProvider.ts, called at executeWorkspace.ts:47
  → FakeAIProvider / AnthropicAIProvider
                                       src/providers/FakeAIProvider.ts (static import, index.ts:4)
                                       src/providers/AnthropicAIProvider.ts (dynamic import, index.ts:80)
  → normalized result/error           AgentOsError / ProviderError shapes, src/errors/AgentOsError.ts,
                                       src/providers/AIProvider.ts — returned through executeWorkspace.ts
                                       back to index.ts unchanged
  → CLI output adapter                src/cli/index.ts:91-96 (stdout/stderr/process.exitCode)
```

**Dependency direction matches the design.** Verified by direct file
inspection this session, not merely by the earlier design intent:

- `executeWorkspace.ts` imports only `AgentOsError`, `AIProvider`, and
  `WorkspaceDefinition` (all types) — zero import of `resolveWorkspace.ts`,
  `FakeAIProvider.ts`, or `AnthropicAIProvider.ts`. `resolveWorkspace` arrives
  purely as an injected function parameter.
- `AIProvider.ts` imports only `AgentOsError`.
- `FakeAIProvider.ts` and `AnthropicAIProvider.ts` both import only
  `AIProvider` (+ `AgentOsError` transitively via its types); only the latter
  additionally imports `@anthropic-ai/sdk`.
- `src/cli/index.ts` is the only file that imports everything, and does so in
  the correct direction (application → workspaces → providers → errors, never
  the reverse).

The dependency graph is a single-direction DAG with no cycles, exactly as
`M0_DESIGN.md` Section 12 specified and as re-confirmed by this session's
`grep`-based structural audits (Section 4).

## 4. Architectural boundaries validated

| Boundary | Evidence | What remains uncertain | Long-term invariant? |
|---|---|---|---|
| Application vs. CLI | `executeWorkspace.ts` has zero `process.env`/`process.argv`/stdout references (confirmed by full read); all I/O lives in `index.ts` | Only one input adapter exists; whether the boundary survives a second (HTTP) adapter is unproven until M1 | Yes — worth enforcing |
| Application vs. workspace | `resolveWorkspace` is injected, not imported, by `executeWorkspace.ts`; `WorkspaceDefinition` is inert data | Only one workspace exists; "different workspace, same use case" is structurally implied but not exercised | Yes, with the caveat that it's untested at n>1 |
| Application vs. provider | `executeWorkspace.ts` imports only the `AIProvider` type, never a concrete adapter (grep-confirmed; test-file imports of `FakeAIProvider` are explicitly permitted and don't count) | — | Yes |
| `AIProvider` port vs. concrete adapters | `AIProvider.ts` imports only `AgentOsError`; two independent, fully-tested implementations exist | Proven with exactly two adapters of the same simple shape; unknown whether the interface holds for a provider needing streaming/tools (explicitly out of M0 scope) | Yes, revisit only if a third provider needs an unmodeled capability |
| Provider-error vs. application-error ownership | `ProviderErrorCode` type-restricts `AIProviderFailure.error` to `PROVIDER_UNAVAILABLE`/`PROVIDER_ERROR`; `executeWorkspace.ts` creates `INVALID_INPUT`/`WORKSPACE_NOT_FOUND` directly; `index.ts` creates `PROVIDER_MISCONFIGURED` directly | — | Yes — strong ADR candidate (Section 12) |
| Configuration/`process.env` | `grep -RIn 'process\.env' src` → only `src/cli/index.ts` (production) and `src/cli/index.e2e.test.ts` (test-only, scrubs the key before spawning) | Nothing prevents a future file from reading `process.env` directly except convention/review — no lint rule enforces this yet | Yes, and worth a lint/CI check in M1+ |
| Anthropic SDK isolation | `grep -RIn '@anthropic-ai/sdk' src` → exactly one file, and even its own test file avoids importing the SDK | — | Yes |
| Network-free testing | `npm test` (32/32) passes with zero network access; offline adapter tests use injected `fetch` | No CI/lint currently prevents a future test from silently adding a real network call | Yes, and a good CI-check candidate for M1 |
| Public error-safety | `index.ts`'s `agentError`/`unexpectedError` render only `code`/`message`, never `.cause`; `AnthropicAIProvider.test.ts`'s safety test confirms the message field excludes secrets/raw bodies/stack-trace-shaped text | Only exercised for CLI rendering; an HTTP adapter would need the same discipline re-verified independently | Yes |

## 5. Provisional decisions reviewed

### Single root package
Stayed simpler and honest: there is exactly one workspace and no second
package-worthy consumer, so nothing needed cross-package resolution. No real
problem arose from the lack of npm workspaces. Concrete condition that would
justify separation later: a second component that genuinely needs independent
versioning, publishing, or its own dependency set (e.g., an HTTP server
package or a truly separate workspace-authoring package) — not close to
existing yet.

### WorkspaceDefinition
`{ id, instructions }` was sufficient for M0's one data point. Echo never
revealed a need for anything beyond a string of instructions — it never
touched tools, permissions, or model preferences, so nothing forced the
contract's hand. Additions that would still be premature: any field for
tools/memory/model preference/metadata, since only one workspace has ever
existed to generalize from — exactly the situation Architecture.md predicted
and asked to be revisited only once a second workspace exists.

### In-memory workspace map
Sufficient. It genuinely exercised the not-found path (not just the happy
path), via both `resolveWorkspace.test.ts` and `executeWorkspace.test.ts`'s
"never calls the provider" assertion. No registry or loader is justified —
no dynamic-registration need appeared anywhere in M0. Evidence that would
justify one: workspaces sourced from something other than compile-time code
(filesystem discovery, a manifest, runtime registration) — nothing in M0
approached that.

### Result-style AIProvider contract
Did improve clarity: `result.ok === false` reads cleanly in every test, and
the discriminated union forced `executeWorkspace` to handle both branches
explicitly. The "duplicated" shape between `AIProviderResult` and
`ExecuteWorkspaceOutput` is real but minor — two structurally similar
`{ok:true,...}|{ok:false,...}` unions exist rather than one shared generic;
acceptable at this scale, flagged as a non-blocking observation in Section 7
rather than something to fix now (introducing a shared generic for two call
sites would itself be a premature abstraction). Expected-vs-unexpected error
handling stayed clear: `AnthropicAIProvider.generate` explicitly rethrows any
error it doesn't recognize (`throw error;`) rather than swallowing it into a
generic `PROVIDER_ERROR` — this is a deliberate, verifiable design choice, not
an oversight.

### Dependency injection
Injecting `AIProvider` and `resolveWorkspace` as plain parameters made every
test in `executeWorkspace.test.ts` possible without a mocking framework beyond
Vitest's own `vi.fn`. A plain dependency object is sufficient; nothing in M0
produced evidence that a DI container would have helped — construction is
manual, small, and entirely readable in `index.ts`.

### Dynamic Anthropic import
The benefit is real and directly measurable: `AnthropicAIProvider` is
referenced exactly once in `index.ts`, inside the `--provider anthropic`
branch, after the API-key check — the default fake path never evaluates that
line. The added complexity is one `if`/`await import(...)` — proportionate,
not over-engineered. It should remain exactly as-is; revisiting would only
make sense if provider selection itself grows into something more complex than
a two-way branch (not needed now).

### Offline Anthropic adapter testing
Custom-`fetch` injection validated the boundary effectively: tests exercise
the SDK's *real* request-building, JSON-response-parsing, and
error-classification code (verified by reading the installed SDK's own type
declarations during implementation), not a hand-mocked stand-in for the SDK's
public surface. What cannot be proven this way: whether Anthropic's actual
production API today still matches these assumed shapes (response envelope,
error envelope, model availability) — that requires the live smoke test,
which was not run. The tests are coupled to the SDK's current error-class
hierarchy (`RateLimitError`/`InternalServerError`/`APIConnectionError`/
`APIError`) — a disclosed, reasonable coupling, not a hidden one, but a future
SDK major-version bump could change that hierarchy and silently invalidate the
assumption (tracked in Section 6).

### CLI composition root
`src/cli/index.ts` is ~100 lines and still appropriately sized: one clear
flow (parse → validate → construct provider → call use case → render).
Argument parsing, provider construction, env reading, and output rendering
all legitimately belong there per the design. No extraction is justified yet
— splitting a ~100-line, single-responsibility file into multiple modules now
would be premature fragmentation, not a clarity improvement.

## 6. Technical-debt assessment

### Accepted and intentional (not debt)
- **No CI** — Roadmap.md/M0_DESIGN.md explicitly deferred this to M1+; the
  actual M0 requirement (commands runnable locally) is met.
- **No compiled production build** (`noEmit: true`, `tsx`-based execution) —
  a documented, deliberate choice (M0_DESIGN.md Section 3), not an oversight.
- **No HTTP adapter** — explicitly excluded from M0 scope by
  Roadmap.md/PROJECT_RULES' backend-first, CLI-first sequencing.
- **No persistence** — explicitly excluded from M0 scope.
- **Fixed model and `max_tokens`** — explicitly called a "tunable constant,
  not architectural" in M0_DESIGN.md Section 16.
- **No logging abstraction** — never in scope; nothing in M0 needs more than
  stdout/stderr.
- **No configuration service** — explicitly decided against in M0_DESIGN.md
  Section 8.

### Should be addressed in M1 (or immediately post-M0)
- **No live Anthropic smoke evidence** — not a defect of M0 (deliberately
  deferred per instructions), but a real, disclosed gap that should be closed
  by someone with a key before the adapter is relied on in anger.
- **npm `allow-scripts` warning** (`esbuild`, `fsevents` postinstall/install
  scripts not run) — currently harmless (both packages' platform binaries
  install correctly via optional dependencies regardless, verified by running
  `esbuild --version`/`tsx --version` this session), but it reappears on every
  install and deserves a conscious "approve or explicitly leave blocked"
  decision rather than an ignored warning.

### Should remain deferred (real, not urgent)
- **SDK-version coupling in offline tests** — acceptable now; only becomes
  urgent at the next `@anthropic-ai/sdk` major version bump.
- **No registry/loader for workspaces** — correctly deferred per
  Architecture.md; revisit only once a second real workspace exists.

### Not actually technical debt
No CI, no HTTP adapter, no persistence, and no Config/Logger abstraction are
**scope decisions**, not debt — debt implies a shortcut taken under pressure;
these were explicit, documented non-goals for this milestone. Labeling them as
debt would misrepresent deliberate scoping as an oversight.

## 7. Code-quality review

Reviewed as a staff engineer would review a small, focused PR.

**`AgentOsError.ts`** — Responsibility: one normalized error shape + a
5-value code union. Naming clear and consistent (the `AgentOs` casing,
lowercase "s", reads naturally and was a deliberate prior correction). Zero
coupling (leaf module). No dedicated test file — correct, since it's pure
types with no logic to exercise. Scope: exactly 4 fields, nothing more. No
maintenance concern at this size.

**`AIProvider.ts`** — Responsibility: the port contract plus the narrowed
`ProviderError`/`ProviderErrorCode`. The type-level ownership restriction
(adapters can only ever construct `PROVIDER_UNAVAILABLE`/`PROVIDER_ERROR`) is
a genuinely strong design touch — it's enforced by the compiler, not just by
convention. Coupling limited to `AgentOsError`, exactly as designed. One
method, no speculative options. Co-locating `ProviderError` here rather than
in `errors/` is a defensible judgment call, already explained by an in-code
comment.

**`FakeAIProvider.ts`** — Tight, clear, fully tested (2 tests cover both
modes exhaustively). The constructor-selected failure mode (not
magic-string-in-input sniffing) is a deliberately good decision, documented
in-code with its own rationale. No concerns.

**`AnthropicAIProvider.ts`** — The most complex file in the tree and still
disciplined: three-way error handling (transient → `PROVIDER_UNAVAILABLE`,
permanent → `PROVIDER_ERROR`, unrecognized → rethrow) is a mature pattern that
avoids masking bugs as provider failures. 11 tests give strong coverage
relative to the file's size (~100 lines). The one real maintenance concern —
hardcoded status-class-to-code mapping duplicating the SDK's own class
hierarchy — is already tracked as deferred debt in Section 6, not hidden.

**`WorkspaceDefinition.ts`** — Two fields, no logic. Nothing to say; correctly
minimal.

**`resolveWorkspace.ts`** — Clear responsibility, matches design vocabulary
exactly. Returns `undefined` on miss rather than throwing — consistent with
the "not-found is a normal return value" pattern used everywhere else in this
codebase. Fully covered by 2 tests (the only two paths that exist). Will need
a small, expected edit (not a rewrite) the moment a second workspace exists —
that's the intended evolution path, not a defect.

**`executeWorkspace.ts`** — The strongest file in the tree. Zero concrete
dependencies (dependency inversion done correctly), no Echo-specific
branching, validates-then-short-circuits without a blanket `try/catch` (so
real bugs still propagate as exceptions), and is exhaustively tested (6 tests,
including "provider not called" assertions via a recording double). This file
is close to a model example of the pattern it's meant to demonstrate.

**CLI composition root (`src/cli/index.ts`)** — Argument parsing, provider
construction, env reading, and rendering all legitimately live here. The
`process.exitCode`-based refactor (done in a prior correction pass) correctly
avoids abrupt `process.exit()` while preserving every exact exit-code/stdout/
stderr contract — confirmed by all 11 e2e tests still passing unchanged. The
one non-blocking nit: the `values` destructuring type is hand-written rather
than derived from the `parseArgs` config object; harmless for one command,
worth revisiting only if a second CLI command is ever added.

**Automated tests (overall)** — One test file per production file,
consistent naming (`*.test.ts` co-located, `*.e2e.test.ts` for the CLI), no
snapshot tests (matches the design's explicit guidance), idiomatic use of
`vi.fn` for recording doubles. Notably, the `AnthropicAIProvider.test.ts`
safety test was caught and corrected mid-implementation for over-asserting on
`cause`'s internal serialization rather than the actual public contract — a
good sign of self-correction during implementation, worth naming here as the
kind of mistake to watch for in future test-writing, not something to redo.

**Blocking defects: none found.**

**Non-blocking improvements** (optional, not required to close M0):
- `ExecuteWorkspaceOutput` and `AIProviderResult` are structurally
  near-identical unions defined twice; not worth unifying into a shared
  generic yet — doing so now would itself be premature abstraction for two
  call sites.
- The CLI's manually-typed `parseArgs` result shape could be derived instead
  of duplicated; low priority at one command.

**Things that should explicitly remain unchanged:** the constructor-injected
`FakeAIProvider` failure mode; the explicit rethrow of unrecognized errors in
`AnthropicAIProvider`; plain-object dependency injection (no container); the
type-level `ProviderError` ownership narrowing.

## 8. Portfolio and interview assessment

**What a reviewer would notice positively:** dependency direction that is
both structurally true and mechanically re-verifiable (grep-checkable, not
just asserted in prose); a provider abstraction actually exercised by two
independent, real implementations rather than a speculative interface with
one implementation; deliberate, *written* rationale for every framework this
project chose not to use (no DI container, no Zod, no Express yet) instead of
silent omission; offline testing of a third-party SDK integration via real
constructor-level `fetch` injection rather than mocking the SDK's own surface
— a level of care many portfolios skip; a CLI that behaves like a
well-mannered Unix tool (distinct exit codes for usage/domain/unexpected
errors, clean stdout/stderr separation, no stack traces leaked).

**Questions the user should be ready to answer:**
- *Why no LangChain?* — M0 needed exactly one call-a-model-and-get-text
  operation; a framework that abstracts chains/memory/orchestration would add
  surface area with zero payoff here and would obscure, rather than prove,
  the port boundary this milestone exists to test.
- *Why a port/adapter boundary?* — to prove, with two real implementations
  and a grep-verifiable invariant, that provider-specific code never leaks
  into application logic — not merely to claim it does.
- *Why a fake provider?* — to keep the default test suite and default CLI
  path deterministic, offline, and secret-free while exercising the exact
  same interface the real provider implements.
- *Why CLI before HTTP/frontend?* — the cheapest possible input adapter to
  validate the application boundary; HTTP adds routing/serialization concerns
  that would be premature to reason about before the use case itself is
  proven.
- *Why one package instead of a monorepo?* — no second package-worthy
  consumer exists yet; workspace tooling would add ceremony with no current
  payoff.
- *Why Result-style errors instead of throw/catch?* — to force exhaustive
  handling of expected failures at compile time while keeping unexpected bugs
  (thrown exceptions) visibly distinct from expected provider failures
  (returned values) — demonstrated concretely by the adapter's explicit
  rethrow of unrecognized errors.
- *Why no broad Config/Logger abstraction yet?* — M0 has exactly one
  configuration value (`ANTHROPIC_API_KEY`) and two output streams
  (stdout/stderr); an abstraction over that is pure ceremony.
- *Why does offline testing of the real provider adapter matter?* — it
  validates the adapter's actual translation logic against the SDK's real
  request/response/error-handling code, without paying for network flakiness,
  secrets, or cost in the default suite — while being explicit that it does
  not prove the live API still matches these assumptions.

**Direct, critical note:** Echo itself is intentionally trivial. A sharp
reviewer will correctly notice that "echo the input back" proves plumbing,
not intelligence, and that a single workspace with a single provider call is
closer to "hello world" than a credible platform foundation. That is
appropriate for M0 and is stated in the design documents — but the user should
say this out loud unprompted rather than let it be discovered. Credibility
here comes from naming the limitation before being asked, not from the code
looking more finished than it is.

## 9. Architecture decisions validated, rejected, or still open

| Decision | Status | Evidence | Consequence |
|---|---|---|---|
| Backend/headless-first sequencing | Validated | CLI-only app works end-to-end with zero UI; 32 tests pass fully offline | Frontend/HTTP work can proceed on a proven use-case boundary |
| CLI first adapter | Validated | `src/cli/index.ts` is a real, fully-tested input adapter using only application contracts | Confirms adapter-swap feasibility for an HTTP option in M1 |
| Provider-neutral `AIProvider` port | Validated | `AIProvider.ts` imports only `AgentOsError`; two independent adapters implement it; grep-verified no SDK leakage | Port can gain a third implementation later without application changes |
| Fake provider for default tests | Validated | `FakeAIProvider.test.ts`; used as default CLI provider; used throughout `executeWorkspace.test.ts` | Default dev/test loop stays offline and fast |
| Anthropic adapter isolation | Validated | `grep`: SDK imported only in `AnthropicAIProvider.ts`; dynamic import confirmed singular and gated | SDK upgrade/removal touches exactly one file |
| Single root package | Validated (for M0's scope) | No cross-package need arose; PROJECT_RULES rule 15 upheld | Revisit only when a second real package-worthy unit appears |
| Workspace contract (`{id, instructions}`) | Still open | Only one data point (Echo) exists; Architecture.md itself marks the shape provisional | A second workspace is needed before the shape can be called validated |
| In-memory resolution | Validated (for one workspace) | `resolveWorkspace.test.ts` covers both hit and miss | Sufficient until multiple/dynamic workspaces are actually needed |
| Kernel/Runtime vocabulary | Still open | M0 deliberately used neutral terms instead, per Architecture.md; no code artifact tests this split at all | Explicitly deferred; M0 provides no new evidence either way |
| `shared/` package | Validated (as "not yet needed") | No `shared/` created; no real cross-process contract exists (no HTTP layer yet) | Revisit only once a real second consumer (frontend/HTTP) exists |
| Error ownership (application vs. provider) | Validated | `ProviderErrorCode` type-restricts adapters; `executeWorkspace`/CLI create the other codes; confirmed by direct file inspection | Strong ADR candidate (Section 12) |
| Result union (no throw) | Validated | `AIProviderResult`/`ExecuteWorkspaceOutput` used consistently; unrecognized errors still rethrown, not swallowed | Pattern proven distinguishable from silently masking bugs |
| Dynamic provider import | Validated | `grep`: exactly one `AnthropicAIProvider` reference in `index.ts`, inside the anthropic branch | Fake path never loads the SDK — a measured, not assumed, benefit |

## 10. M1 options

### Option A — Express HTTP adapter over the existing `executeWorkspace`
- **Value:** proves the application boundary survives a second, structurally
  different input adapter (routing/serialization), which is the specific
  "provisional/open" item Architecture.md's build-order rule has been waiting
  on since M0's design.
- **Reusable capability proven:** `executeWorkspace`, the `AIProvider` port,
  and the error model are all reused unchanged.
- **Scope:** one HTTP route (e.g. `POST /run`), request validation at the
  transport boundary (the first point where schema validation — Zod or
  otherwise — becomes justified per Architecture.md's own placement rule),
  transport-safe DTO mapping to/from `ExecuteWorkspaceInput`/`Output`.
- **Explicit exclusions:** no frontend, no auth, no persistence, no second
  workspace, no streaming.
- **Risks:** temptation to add auth/persistence "while we're in there";
  temptation to create a `shared/` package for the DTOs before a real
  frontend consumer exists to justify it.
- **Why it's a strong next step:** it answers a real open architectural
  question for the smallest reasonable amount of new code.

### Option B — Run identifiers and structured run results
- **Value:** implements the "run-level identifiers and generic execution
  results" line from Architecture.md's ownership table, which currently has
  zero implementation — a result with no id is hard to correlate in any
  future logging/telemetry story.
- **Reusable capability proven:** whether a run-id concept fits cleanly into
  `executeWorkspace`'s existing shapes without breaking the Result-union
  pattern.
- **Scope:** a generated run id attached to `ExecuteWorkspaceInput`/`Output`
  (or a thin wrapper around them), surfaced by the CLI (and HTTP adapter, if
  built).
- **Explicit exclusions:** no persistence of run history, no querying past
  runs, no logging abstraction.
- **Risks:** easy to scope-creep into "let's add a run store."
- **Why it might not be next:** real but lower-value standing alone; better
  paired with the HTTP option than as all of M1 by itself.

### Option C — Minimal CI for typecheck and network-free tests
- **Value:** converts today's "run these commands locally" discipline into an
  enforced, repeatable gate — the exact gap M0_DESIGN.md Section 16 named as
  deferred.
- **Reusable capability proven:** none architectural — this is process
  infrastructure, not a design boundary.
- **Scope:** one CI workflow running `npm ci`, `npm run typecheck`,
  `npm test` (excluding `smoke:anthropic`) on push/PR.
- **Explicit exclusions:** no deployment, no live-key smoke test in CI, no
  coverage thresholds.
- **Risks:** low; main risk is scope-creep into a larger pipeline
  (linting/formatting/coverage gates) that wasn't asked for.
- **Why it might not be next standalone:** valuable but answers no open
  architectural question by itself — good as a small rider on whichever of
  A/B is chosen, not a full milestone on its own.

Do not combine all three into one milestone — see Section 11.

## 11. Recommended M1

**Goal:** prove the application/use-case boundary through a second,
structurally different input adapter (HTTP) without modifying
`executeWorkspace`, the `AIProvider` port, or the error model — plus a small,
low-risk CI rider.

**Why this is the correct next learning step:** it is the one remaining
"provisional/open" item whose resolution requires new code rather than more
analysis (Architecture.md's build-order rule explicitly has the frontend
waiting on this), and it produces the most new architectural evidence
(validation-at-the-edge, DTO mapping, a first real justification-or-not for a
schema-validation library) for the smallest reasonable scope. Option B (run
identifiers) is real but is better deferred until there's a second consumer
(the HTTP adapter itself, or a future frontend) that actually needs to
correlate runs.

**Included work:**
- One Express route wrapping `executeWorkspace`.
- Request parsing/validation at the transport boundary.
- Mapping to/from `executeWorkspace`'s existing `ExecuteWorkspaceInput`/
  `Output` types — no changes to those types themselves.
- HTTP error responses with the same safety discipline as the CLI (code/message
  only, never cause/stack/secrets).
- A minimal CI workflow: `npm ci`, `npm run typecheck`, `npm test` (network-free
  only) on push/PR.

**Excluded work:** frontend, authentication, persistence, streaming, a second
workspace, a `shared/` package (DTOs stay local to the HTTP adapter unless a
real second consumer needs them), run identifiers/structured run results
(defer to a later milestone).

**Objective exit criteria:**
- The HTTP route is reachable locally and its request/response mapping is
  unit-testable without a live server, the same way `executeWorkspace` is
  tested today.
- Error responses never leak `cause`, stack traces, or secrets — verified by
  a dedicated safety test mirroring the CLI's.
- No change is required to `executeWorkspace.ts`, `AIProvider.ts`, or
  `AgentOsError.ts` to support the HTTP adapter.
- CI runs typecheck + network-free tests on every push and passes.

**Documentation/design work required before implementation:** an
`M1_DESIGN.md`, structured like `M0_DESIGN.md`, that resolves at minimum: the
exact request/response DTO shape; whether/where a schema-validation library
(Zod or otherwise) becomes justified now that untrusted network input exists;
explicit confirmation that a `shared/` package is still not needed (DTOs
local to the HTTP adapter unless a real second consumer exists); and the
HTTP error-response contract (status codes, safe body shape).

M1 is not implemented in this task.

## 12. ADR recommendations

1. **"The `AIProvider` port: a Result-returning, provider-neutral boundary"**
   — Evidence-backed now: two real implementations exist, non-leakage is both
   type-enforced and grep-verifiable, and the expected-vs-unexpected error
   split is proven by `AnthropicAIProvider`'s explicit rethrow. **Write before
   M1** — the HTTP adapter will consume this exact contract and shouldn't be
   built against an undocumented assumption.
2. **"Provider-error ownership split (`ProviderErrorCode` vs. `AgentOsErrorCode`)"**
   — Implemented, type-checked, and tested (the safety test plus in-code
   ownership comments). **Write before M1** — this is precisely the kind of
   rule a new contributor (or the HTTP adapter's author) needs written down
   rather than re-derived from reading three files.
3. **"CLI-before-HTTP: one input adapter at a time"** — M0's existence is the
   evidence; Architecture.md's build-order rule is the source, but an ADR
   capturing *why* it worked (headless-first forced honesty about the
   `executeWorkspace` boundary) is worth capturing before the lesson dilutes
   into "we just do things in this order." **Write before or during M1
   kickoff** — lower urgency than the two above since the rule itself is
   already documented in Architecture.md.
4. *(Lower priority, optional)* **"Single root package until a second real
   consumer exists"** — real but easily re-derived from PROJECT_RULES rule 15;
   fine to write during M1 rather than urgently now.

No ADR files were created in this task.

## 13. Final M0 closeout checklist

- [x] Design committed (`8f836a5 docs: define M0 Echo walking skeleton`)
- [x] Implementation committed (`c709357 feat: implement Echo walking skeleton`)
- [x] Clean installation (`npm ci` succeeds — re-verified this session)
- [x] Type-check passes (`tsc --noEmit`, clean)
- [x] Network-free tests pass (32/32, re-run this session)
- [x] CLI success path verified (`Echo: Hello`, exit 0)
- [x] Failure handling verified (simulated failure, unknown workspace, blank
      input, misconfigured provider — all correct messages/exit codes)
- [x] Anthropic adapter offline tests present and passing (11 tests: request
      translation, response normalization, transient/permanent errors, safety)
- [ ] Optional live smoke test — **not run** (by design/instruction); disclosed
      follow-up, not a blocker
- [x] Scope exclusions held (no frontend/HTTP/persistence/tools/memory/
      planner/`shared/`/`kernel/`/`runtime/` — directory- and grep-verified)
- [x] Architecture review completed (this document)

**Remaining blockers to closing M0 itself: none.** The only open item (live
smoke evidence) is an explicitly deferred follow-up, not a blocker to the
milestone's own scope.

## 14. Final recommendation

**M0 READY TO CLOSE WITH DOCUMENTED FOLLOW-UP.**

Follow-up items (tracked, not blocking): (1) run the live `smoke:anthropic`
path once a real API key is available, before relying on
`AnthropicAIProvider` against the production API in M1+; (2) make a conscious
decision about the `npm allow-scripts` warning (approve or explicitly leave
blocked) rather than letting it persist unacknowledged.

**On merging:** yes, the branch is reasonable to merge once this review is
approved. The working tree is clean, both the design and implementation
commits are in place, `npm ci`/typecheck/tests all pass reproducibly, and
nothing further needs to happen *on this branch* before merge — the
live-smoke follow-up is an out-of-band manual check independent of what's in
the tree, and doesn't need to gate the merge itself.
