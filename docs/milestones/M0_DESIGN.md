# M0 Design — Echo Walking Skeleton

Status: design only. No application code, `package.json`, dependencies, or
tests exist yet. This document must be reviewed before implementation begins.
It complies with [../Vision.md](../Vision.md), [../Architecture.md](../Architecture.md),
[../Roadmap.md](../Roadmap.md), and [../PROJECT_RULES.md](../PROJECT_RULES.md);
no conflicts were found between those documents during design.

## 1. Purpose

M0 proves that a single, minimal vertical slice actually works end-to-end,
using neutral application-architecture terms rather than "kernel"/"runtime"
(per Architecture.md, that split is unvalidated and not part of M0):

```
CLI input adapter
  → execute-workspace application use case
  → Echo workspace resolution
  → provider-neutral AIProvider port
  → FakeAIProvider or AnthropicAIProvider adapter
  → normalized Agent OS result
  → CLI output adapter
```

Concretely, M0 proves:

- A CLI can invoke one application use case with no other input adapter.
- Workspace resolution is a real code path (including "unknown workspace"),
  not a hardcoded shortcut.
- The `AIProvider` port is genuinely provider-neutral, with two working
  implementations behind it (`FakeAIProvider`, `AnthropicAIProvider`).
- Provider failures are normalized into Agent OS's own error shape before
  they reach the use case or the CLI.
- `AnthropicAIProvider`'s own request/response/error translation is verified
  offline, with zero network access, as part of the default test suite —
  not only through a live, manually-triggered smoke test.
- The default, automated path requires no network access and no secrets.

M0 intentionally does **not** prove or attempt:

- That the workspace contract is complete or final (Echo is one data point).
- That the eventual orchestration/execution ("kernel"/"runtime") split is
  correct — that question stays open per Architecture.md.
- Anything about tools, memory, planning, multi-agent execution, persistence,
  a frontend, or an HTTP transport API.
- Production readiness, performance, or scale. M0 is a walking skeleton, not
  a general agent framework, and must not grow speculative capability beyond
  what this document specifies.

## 2. Scope

### Included

- One **Echo reference workspace** (the only workspace M0 knows about).
- One CLI command (`npm run agent`), with no interactive prompts.
- One application use case (`executeWorkspace`).
- One minimal workspace-resolution mechanism (in-memory map — see Section 6).
- One provider-neutral `AIProvider` port, plus a narrow `ProviderError`
  contract scoped to it (Section 5, "Agent OS error").
- One deterministic `FakeAIProvider` adapter (default, offline).
- One `AnthropicAIProvider` adapter, unit-tested offline via an injected
  fake transport (Section 5/9) — a separate, optional live smoke test
  remains manual.
- One normalized success result shape.
- One normalized error representation (`AgentOsError`, small fixed code set).
- Unit tests for the `executeWorkspace` use case.
- Offline unit tests for `AnthropicAIProvider`'s request translation,
  response normalization, and error translation (transient/permanent).
- One end-to-end CLI test using the fake provider.
- One optional, manually-triggered Anthropic live smoke-test path.
- The minimal configuration needed for the optional real adapter
  (`ANTHROPIC_API_KEY` only, `.env.example`).

### Explicitly excluded from M0

- React, Vite frontend
- Express, HTTP routes
- SQLite, PostgreSQL, or any persistence
- Memory
- Tools, tool registry
- Prompt manager
- Planner, reviewer
- Multi-agent execution
- Streaming
- Authentication
- Background jobs
- Plugin system
- A general-purpose dependency-injection framework
- Physical `kernel/` and `runtime/` packages
- A `shared/` package (no real cross-process contract exists yet — M0 is
  CLI + backend only, per Architecture.md's `shared/` scope rule)
- Model selection as a CLI-exposed or workspace-level concern (Section 5/8)
- Custom SDK retry logic (Section 5 fixes `maxRetries: 0` — no retry policy
  is implemented in M0)

If implementation reveals a need for any of the above, that need is recorded
as an open question for the post-M0 architecture review (Roadmap.md), not
added ad hoc during M0.

## 3. Technical decisions

### Node runtime

**Decision:** target **Node.js 24 LTS**, precisely — not merely "a current
LTS line."

- Future `package.json`:
  ```json
  {
    "engines": { "node": ">=24 <25" }
  }
  ```
  The upper bound (`<25`) is deliberate: Node 25 (an odd-numbered, Current,
  non-LTS release) and Node 26 (a future LTS candidate) are **not**
  automatically declared compatible just because they're newer — bumping the
  range is a future decision made once that version has actually been
  validated against this project, not assumed now.
- Future `.nvmrc`:
  ```
  24
  ```
  `.nvmrc` is **repository metadata** — a plain text file a version manager
  *may* read if a contributor happens to use one — not a version-manager
  dependency itself. Nothing in M0 requires `nvm`, `volta`, or any other
  version manager to be installed; the file simply documents the exact
  version the `engines` range targets.
- `engine-strict` remains disabled (left unset in `.npmrc`) — the `engines`
  field and `.nvmrc` are documentation, not a hard install-time gate, so a
  contributor on a newer compatible Node isn't blocked by npm.
- **No Node installation or upgrade occurs during this design task** — this
  section only specifies what the future `package.json`/`.nvmrc` will say.

### Package manager and workspace structure

**Decision: Option A — one root package.**

| | Option A: single root package | Option B: npm-workspaces monorepo (backend + echo-workspace packages) |
|---|---|---|
| Structural honesty for M0 | Matches reality: exactly one workspace exists, and a `WorkspaceDefinition` is data, not a deployable unit | Implies workspaces are independently-versioned/publishable units — not true yet, and not demonstrated as needed |
| Cross-package boundary proven? | The important boundary (application ↔ `AIProvider` port ↔ adapters) is proven by folder-level module boundaries and the dependency rules in Section 12 — package boundaries add nothing extra here | Would add an `npm workspaces` package boundary around a single Echo workspace with no second consumer to justify it |
| Matches PROJECT_RULES | Yes — rule 15 ("do not create a package speculatively"), rule 11 ("workspace contract stays minimal... until a second workspace exists") | Violates the spirit of both rules for M0 specifically |
| Cost | One `package.json`, flat `src/` | Two `package.json`s, workspace-root wiring, cross-package import resolution to get right — pure overhead for one workspace |

Option A is recommended: it is the smallest structure that still proves the
*module*-level boundary (application code depending on a port interface, not
concretely on an adapter) honestly. Physical package separation is deferred
until a second workspace or a second consumer actually needs independent
packaging — not before (Architecture.md, "Provisional / open").

### TypeScript module system

- **ESM**, not CommonJS: `package.json` sets `"type": "module"`. Node 24 has
  mature native ESM support; there is no other consumer (no CJS-only
  dependency) forcing CommonJS.
- `tsconfig.json` (sketch, not created yet):
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "strict": true,
      "noUncheckedIndexedAccess": true,
      "exactOptionalPropertyTypes": true,
      "noImplicitOverride": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "skipLibCheck": true,
      "noEmit": true
    },
    "include": ["src"]
  }
  ```
- **Strictness:** full `strict: true` plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` — cheap to hold from day one, expensive to
  retrofit later, and the codebase is small enough that it costs nothing now.
- **Source/output approach:** `noEmit: true` — M0 has no build/`dist/` step.
  `tsc` is used only for type-checking; the CLI runs directly from `src/`
  via `tsx` (see next section). A real build step is deferred until
  something (packaging, deployment) actually needs compiled output — not
  required by any M0 exit criterion.

### Runtime execution

**Decision: `tsx`**, not a `tsc`-then-`node dist/...` build step.

- `tsc --noEmit && node dist/cli/index.js` would require a build step before
  every CLI invocation during development, plus a `dist/` output directory
  and its own `.gitignore` entry — overhead with no M0 payoff, since nothing
  in M0 needs a shippable compiled artifact.
- `tsx` runs TypeScript/ESM directly (`tsx src/cli/index.ts`) with no config
  and no output directory, which is the smallest reasonable way to run and
  iterate on the CLI and matches the "no unnecessary build tooling"
  instruction directly.
- No bundler (esbuild/webpack/rollup as a standalone step) is introduced —
  `tsx` and `vitest` both use `esbuild` internally as an implementation
  detail, not as a project-level bundling step we configure or maintain.

### Testing framework

**Decision: Vitest.**

| Criterion | Node built-in `node:test` | Vitest |
|---|---|---|
| TypeScript support | Requires a loader/flag and doesn't type-check by itself; works but is not zero-config | Native, zero-config TS execution via esbuild |
| Dependency weight | Zero extra dependency | One dependency (bundles its own esbuild transform) |
| Mocking needs | Minimal built-in mocking; would need extra packages for spies/mocks if ever needed | `vi.fn`/`vi.spyOn` built in — useful for the request-recording tests in Section 9 |
| Test clarity | Adequate but sparser assertion API (relies on `node:assert`) | Familiar `describe`/`it`/`expect` API, better failure output |
| Future React compatibility | Would need a second framework (or jsdom + extra plumbing) once the M2 frontend arrives | First-class Vite/React/jsdom support later, avoiding a framework migration |
| Avoiding unnecessary tools | Best in isolation | Slightly more than isolation-optimal, but avoids a near-certain later migration |

Given the project's own roadmap commits to a React frontend later (M2) and
the instructions explicitly weigh "future React compatibility," Vitest is
recommended as the **one** test framework used from M0 onward, rather than
starting with `node:test` and migrating later.

### Validation library

**Decision: no schema-validation dependency (no Zod) in M0.**

M0 has exactly one place that could be called a "runtime boundary" for
external input: CLI arguments (`--workspace`, `--input`, `--provider`,
`--simulate-failure`) — four flat, non-nested string/boolean flags with no
JSON parsing and no deserialization of untrusted structured data. Per the
instructions, "CLI argument validation alone is not automatically sufficient
justification," and a few `if` checks (non-empty string, one-of-two enum)
are simpler and clearer than a schema library for this shape. `AnthropicAIProvider`
parses a fixed, well-known API response shape (Section 5) — not arbitrary
untrusted JSON — so it doesn't change this conclusion either.

This should be revisited once the HTTP transport API (M2) introduces
untrusted network input crossing a real process boundary — that is the
"concrete runtime boundary" the placement rule in Architecture.md
contemplates, not M0's CLI flags.

## 4. Proposed file tree

```
agent-os/
├── package.json                          # NOT created in this task — sketch only (Section 10/11)
├── tsconfig.json                         # NOT created in this task — sketch only (Section 3)
├── .nvmrc                                # NOT created in this task — contains "24"; repository metadata, not a version-manager dependency (Section 3)
├── .env.example                          # NOT created in this task — documents ANTHROPIC_API_KEY with no real value
├── .gitignore                            # existing file — needs a `.env` entry added at implementation time
├── docs/
│   └── milestones/
│       └── M0_DESIGN.md                  # this document
└── src/
    ├── cli/
    │   ├── index.ts                      # CLI composition root: parses argv, reads ANTHROPIC_API_KEY when needed, dynamically imports AnthropicAIProvider only when selected, calls executeWorkspace, writes stdout/stderr, sets the exit code
    │   └── index.e2e.test.ts             # spawns the real CLI process (via tsx) and asserts stdout/stderr/exit code for the success and simulated-failure paths
    ├── application/
    │   ├── executeWorkspace.ts           # the execute-workspace use case: validates input, resolves the workspace, calls the AIProvider port, returns a normalized result — no I/O
    │   └── executeWorkspace.test.ts      # unit tests for the use case (success, provider failure, unknown workspace, invalid input, instructions pass-through)
    ├── workspaces/
    │   ├── WorkspaceDefinition.ts         # the WorkspaceDefinition contract (id + instructions only)
    │   ├── echoWorkspace.ts              # the one exported Echo WorkspaceDefinition constant
    │   ├── resolveWorkspace.ts           # the minimal in-memory-map resolution function keyed by workspace id
    │   └── resolveWorkspace.test.ts      # unit tests: known id resolves, unknown id returns undefined
    ├── providers/
    │   ├── AIProvider.ts                 # the provider-neutral port: AIProviderRequest/AIProviderResult types, the narrow ProviderError/ProviderErrorCode contract, and the AIProvider interface
    │   ├── FakeAIProvider.ts             # deterministic, offline, no-secrets adapter implementing AIProvider (success mode + constructor-selected failure mode)
    │   ├── FakeAIProvider.test.ts        # unit tests for the fake adapter's own success/failure behavior
    │   ├── AnthropicAIProvider.ts        # the only file that imports @anthropic-ai/sdk; translates requests/responses/errors across the port; accepts an optional injectable fetch for testing
    │   └── AnthropicAIProvider.test.ts   # offline unit tests: request translation, response normalization, transient/permanent error translation, safety — all via an injected fake fetch, zero network calls, no SDK import needed
    └── errors/
        └── AgentOsError.ts               # the normalized error shape + the small, fixed AgentOsErrorCode union
```

No `utils/`, `helpers/`, `common/`, `services/`, or `managers/` folder exists.
No empty `frontend/`, `shared/`, `persistence/`, `tools/`, `memory/`,
`planner/`, `reviewer/`, or `registry/` package or folder is created.

## 5. Core contracts

The sketches below are illustrative design shapes only — none are written to
source files in this task.

### WorkspaceDefinition

```ts
// design sketch — not implemented in this task
interface WorkspaceDefinition {
  readonly id: string;
  readonly instructions: string;
}
```

- **Owned by:** Agent OS core. The contract's shape is defined and owned by
  the application/workspace-resolution layer, per Architecture.md's
  ownership table ("workspace registration/resolution mechanism" is
  Agent-OS-owned).
- **Implemented/provided by:** each workspace module. In M0, exactly one:
  `echoWorkspace.ts` exports a single constant satisfying this interface.
- **Resolved by:** `resolveWorkspace(id: string): WorkspaceDefinition | undefined`,
  called by the `executeWorkspace` use case — not by the CLI directly (the
  CLI only passes the raw `workspaceId` string through).
- **Why Echo cannot invoke the AI provider directly:** `WorkspaceDefinition`
  is pure data (two `readonly` string fields, no methods) — it is
  structurally incapable of calling anything. Invoking the provider is the
  use case's job ("AI provider invocation" is Agent-OS-core-owned per
  Architecture.md's ownership table), which keeps workspaces as passive
  configuration and enforces PROJECT_RULES rule 10 (a workspace must not
  import a provider SDK or bypass the port) by construction, not convention.
  Model selection is likewise not workspace behavior (Section 6/8) — a
  workspace never references a provider or a model.

### AIProvider port

```ts
// design sketch — not implemented in this task
interface AIProviderRequest {
  readonly instructions: string;
  readonly input: string;
}

interface AIProviderSuccess {
  readonly ok: true;
  readonly output: string;
}

// A narrow contract: AIProviderFailure may only ever carry a ProviderError,
// never the full AgentOsErrorCode union — a provider adapter cannot claim to
// produce, e.g., INVALID_INPUT or WORKSPACE_NOT_FOUND, which are exclusively
// application-owned (see "Error and provider-error ownership" below).
type ProviderErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR";

interface ProviderError extends AgentOsError {
  readonly code: ProviderErrorCode;
}

interface AIProviderFailure {
  readonly ok: false;
  readonly error: ProviderError;
}

type AIProviderResult = AIProviderSuccess | AIProviderFailure;

interface AIProvider {
  generate(request: AIProviderRequest): Promise<AIProviderResult>;
}
```

`AIProvider.ts` may still depend only on `AgentOsError.ts` (Section 12) —
`ProviderErrorCode`/`ProviderError` are defined here because they narrow the
port's own failure shape; they do not introduce a new dependency or a
generic error hierarchy, just a smaller allowed subset of the existing
`AgentOsErrorCode` union.

**Decision: a Result-style discriminated union, not throwing.**

Tradeoff considered: throwing normalized `AgentOsError`s would let callers
use plain `try/catch`, which is a familiar shape. But it blurs *expected*
provider failures (rate limits, invalid requests, transient network errors)
with *unexpected* programming bugs, both of which would otherwise arrive at
the same `catch` block. Returning `AIProviderResult` instead:

- Forces the use case to handle the failure branch explicitly (TypeScript's
  discriminated-union exhaustiveness checking), rather than an easily-missed
  `catch`.
- Keeps genuine bugs (e.g., a thrown `TypeError` from a coding mistake)
  propagating as real exceptions instead of being silently absorbed into a
  "normalized result" — only the adapter's *known* provider-error cases are
  translated into `AIProviderFailure`.
- Makes `FakeAIProvider`'s deliberately-triggered failure trivial to assert
  on in tests (`result.ok === false`) without needing to catch a thrown type.

This is the one method the port exposes in M0 — no streaming, no tool
calls, no multimodal input, no conversation history, no token accounting,
and no provider-specific options. `AIProviderRequest` carries exactly
`instructions` and `input`; nothing else is needed to prove the slice.

### FakeAIProvider adapter

```ts
// design sketch — not implemented in this task
interface FakeAIProviderOptions {
  readonly behavior?: "success" | "failure"; // defaults to "success"
}

class FakeAIProvider implements AIProvider {
  constructor(options?: FakeAIProviderOptions);
  generate(request: AIProviderRequest): Promise<AIProviderResult>;
}
```

- **Success mode (default):** always returns
  `{ ok: true, output: \`Echo: ${request.input}\` }` — fully deterministic,
  derived only from the request, no randomness, no clock, no I/O.
- **Failure trigger:** a **constructor option** (`{ behavior: "failure" }`),
  not magic text inside `--input`. Tests and the CLI's `--simulate-failure`
  flag construct `new FakeAIProvider({ behavior: "failure" })` explicitly.
  This is chosen over sniffing the input string because a magic string is
  fragile (a real user could accidentally type it, and it silently couples
  test behavior to content the use case is supposed to treat as opaque);
  an explicit constructor option makes the trigger visible at the call site
  and impossible to hit by accident.
- Failure mode returns
  `{ ok: false, error: { code: "PROVIDER_ERROR", message: "The fake provider was configured to fail.", retryable: false } }`
  — a valid `ProviderError`.
- **No network access:** the implementation only resolves an already-formed
  in-memory value (via `Promise.resolve`/`await` to preserve the async
  shape) — no `fetch`, no sockets.
- **No secrets:** never reads `process.env`.
- **No Anthropic imports:** zero references to `@anthropic-ai/sdk`.

### AnthropicAIProvider adapter

```ts
// design sketch — not implemented in this task
interface AnthropicAIProviderOptions {
  readonly apiKey: string;
  readonly model?: string; // defaults to DEFAULT_ANTHROPIC_MODEL — adapter-level/testing use only; never exposed by the CLI
  readonly fetch?: typeof globalThis.fetch; // test-only injection point; omitted in production, in which case the SDK's real fetch is used
}

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

class AnthropicAIProvider implements AIProvider {
  constructor(options: AnthropicAIProviderOptions);
  generate(request: AIProviderRequest): Promise<AIProviderResult>;
}
```

- **Sole SDK import location:** `src/providers/AnthropicAIProvider.ts` is the
  only file in the repository allowed to `import` `@anthropic-ai/sdk`. Its
  own test file (`AnthropicAIProvider.test.ts`) does **not** need to import
  the SDK — it only needs `AnthropicAIProvider` itself and a plain
  Fetch-API-shaped fake function (see "Offline testing" below).
- **Required environment variable:** `ANTHROPIC_API_KEY` only. It is read by
  the **CLI composition root**, not by this adapter and not by the SDK's own
  implicit env lookup — the key is passed in explicitly as `apiKey` so the
  adapter stays unit-testable with an injected fake key and so the CLI can
  produce a friendly `PROVIDER_MISCONFIGURED` error before ever constructing
  the adapter or touching the SDK.
- **Model selection:** constructor option `model`, defaulting to a documented
  constant `DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5"`. This exists purely
  for adapter-level testing and future composition — **M0 exposes no
  `ANTHROPIC_MODEL` environment variable and no CLI model flag.** Model
  selection is not workspace behavior and is not CLI-configurable in M0
  (Section 6/8).
- **SDK client construction is fixed and explicit:**
  `maxRetries: 0` and `timeout: 30_000` (30 seconds) are passed to the
  Anthropic SDK client alongside `apiKey` and the optional `fetch` override.
  - **Why `maxRetries: 0`:** the Anthropic SDK retries transient errors by
    default; M0 intentionally disables that so a given simulated or real
    failure maps to exactly one, deterministic `AgentOsError` — no hidden
    retry loop between the request and the normalized result. A retry
    *policy* is a runtime/orchestration concern deferred until M0 (or a
    later milestone) has an explicit one — not implemented here.
  - **Why `timeout: 30_000`:** the SDK's own default timeout is much longer;
    a 30-second cap keeps the CLI (and especially the manual smoke path)
    from appearing to hang indefinitely on a slow/unreachable connection.
  - Neither value is configurable via `AnthropicAIProviderOptions` — they are
    fixed constants inside the adapter, not tuned per call site.
- **Request translation:** `AIProviderRequest { instructions, input }` maps
  to an Anthropic Messages API call: `system: instructions`,
  `messages: [{ role: "user", content: input }]`, `model`, and a fixed
  `max_tokens` default (1024 — a tunable constant, not an architectural
  decision; see Section 16).
- **Response normalization:** concatenate the response's `text`-type content
  blocks into a single string → `{ ok: true, output: <text> }`. No other
  fields from the SDK response are exposed — the raw Anthropic response
  object never escapes through `AIProvider`.
- **Error translation:** catch Anthropic SDK errors and map them to
  `ProviderErrorCode`:
  - Rate-limit (429), server-side (500/529-class), timeout, and
    connection-level failures (the SDK's own connection/timeout error types,
    raised when the underlying `fetch` rejects or aborts) → `PROVIDER_UNAVAILABLE`,
    `retryable: true`.
  - Bad-request/authentication/permission-class failures (400/401/403, and
    similar 4xx) → `PROVIDER_ERROR`, `retryable: false`.
  The raw SDK error object is never returned to the caller; it may be
  attached as the normalized error's `cause` for local diagnostics only —
  and `cause` is never rendered by any public adapter (CLI stderr today,
  the HTTP transport API later).
- **Never logged or exposed:** the API key, full request/response bodies
  (which may contain prompt content), the raw SDK error object, and stack
  traces. Only `AgentOsError.code` and `.message` ever reach the CLI's
  stderr output.
- **Offline testing (`AnthropicAIProvider.test.ts`):** the constructor's
  optional `fetch` option is the **sole** test-injection point — confined
  entirely to this adapter, requiring no change to the provider-neutral
  `AIProvider` port and exposing no Anthropic SDK type through it. Tests
  construct `new AnthropicAIProvider({ apiKey: "test-key", fetch: fakeFetch })`
  where `fakeFetch` is a plain function matching the standard Fetch API
  signature (`(input, init) => Promise<Response>`) that:
  - records the outgoing request (headers/body) for the translation
    assertions, and
  - returns a canned `Response` (a real JSON success body, a 429/500/529
    error body, or a 400/401/403 error body), or throws/rejects to simulate
    a connection failure.
  This requires no real API key (a dummy string is used), no network
  access, and no modification of `globalThis.fetch` — the injection is
  constructor-level, which is practical here since the Anthropic SDK client
  accepts a custom `fetch` implementation directly.
- **Why the live smoke test remains separate:** the offline tests above
  cover all of this adapter's own translation logic. What they cannot cover
  is whether the *real* Anthropic API still behaves the way this adapter
  assumes — that requires an actual network call with a live key, which is
  exactly what `smoke:anthropic` (Section 10) is for, and exactly why it
  stays manual and outside `npm test`.

No tools, streaming, retries, conversation history, or other advanced
provider options are implemented in M0.

### Agent OS error

```ts
// design sketch — not implemented in this task
type AgentOsErrorCode =
  | "INVALID_INPUT"
  | "WORKSPACE_NOT_FOUND"
  | "PROVIDER_MISCONFIGURED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR";

interface AgentOsError {
  readonly code: AgentOsErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}
```

Five codes, deliberately small, matching exactly what M0 needs — not a
future taxonomy:

| Code | Meaning | `retryable` |
|---|---|---|
| `INVALID_INPUT` | `--input` was empty/whitespace-only | `false` |
| `WORKSPACE_NOT_FOUND` | requested `workspaceId` has no resolution | `false` |
| `PROVIDER_MISCONFIGURED` | e.g. Anthropic selected with no API key | `false` |
| `PROVIDER_UNAVAILABLE` | transient provider failure (rate limit, server error, timeout, connection failure) | `true` |
| `PROVIDER_ERROR` | any other provider failure, including the fake provider's forced failure | `false` |

**Error and provider-error ownership:**

- `executeWorkspace` creates `INVALID_INPUT` and `WORKSPACE_NOT_FOUND`
  directly — these are application-owned and can never come from a
  provider adapter (enforced by `ProviderErrorCode` being a strict subset of
  `AgentOsErrorCode` that excludes both).
- The **CLI composition root** creates `PROVIDER_MISCONFIGURED` (e.g.,
  Anthropic selected with no `ANTHROPIC_API_KEY`) — before any adapter is
  even constructed.
- Provider adapters (`FakeAIProvider`, `AnthropicAIProvider`) create **only**
  `PROVIDER_UNAVAILABLE` or `PROVIDER_ERROR` — the two codes `ProviderError`
  allows — never any other code in the union.
- No matter which of the above produced an `AgentOsError`, public rendering
  (the CLI's stderr today, an HTTP transport API later) never exposes
  `.cause` — only `.code` and `.message`.

No generics and no broader error hierarchy are introduced — `ProviderError`
is a plain, narrower interface, not a generic `Result<T, E>` or class
hierarchy.

### Execute-workspace use case

```ts
// design sketch — not implemented in this task
interface ExecuteWorkspaceInput {
  readonly workspaceId: string;
  readonly userInput: string;
}

type ExecuteWorkspaceOutput =
  | { readonly ok: true; readonly output: string }
  | { readonly ok: false; readonly error: AgentOsError };

interface ExecuteWorkspaceDependencies {
  readonly resolveWorkspace: (id: string) => WorkspaceDefinition | undefined;
  readonly aiProvider: AIProvider;
}

function executeWorkspace(
  input: ExecuteWorkspaceInput,
  deps: ExecuteWorkspaceDependencies
): Promise<ExecuteWorkspaceOutput>;
```

- **Input:** `workspaceId`, `userInput` — plain strings, nothing else.
- **Output:** the same `{ ok, ... }` shape as the port, so the CLI has one
  consistent result shape to render. (`ProviderError` is assignable wherever
  `AgentOsError` is expected, since it's a narrower subtype — no separate
  mapping step is needed when passing a provider failure through.)
- **Dependencies:** `resolveWorkspace` and an `AIProvider`, both injected —
  never imported concretely (no `FakeAIProvider`/`AnthropicAIProvider`
  reference inside this file).
- **Validation responsibilities:** trims and checks `userInput` is
  non-empty (→ `INVALID_INPUT` if not); calls `resolveWorkspace` and checks
  for a defined result (→ `WORKSPACE_NOT_FOUND` if not). No provider-specific
  validation happens here — that is the adapter's job.
- **Execution sequence:**
  1. Validate `userInput`; short-circuit with `INVALID_INPUT` on failure.
  2. Resolve the workspace; short-circuit with `WORKSPACE_NOT_FOUND` on
     failure.
  3. Build `{ instructions: workspace.instructions, input: userInput }`.
  4. Call `deps.aiProvider.generate(request)`.
  5. Pass an `{ ok: false }` result through unchanged.
  6. Map an `{ ok: true }` result to `{ ok: true, output }`.
- **Error behavior:** never throws for expected conditions (steps 1–2, or a
  provider failure at step 4/5) — all are returned as `ExecuteWorkspaceOutput`.
  It does **not** wrap dependency calls in a defensive blanket `try/catch`;
  a genuinely unexpected exception (a bug in `resolveWorkspace` or the
  injected provider) propagates uncaught. This is deliberate: catching
  everything would risk masking real bugs as ordinary "normalized" failures.
  The CLI composition root is the outermost boundary responsible for
  catching any such unexpected exception and reporting it safely (Section 7).
- **Must not:** read `process.env`; parse CLI arguments; write to stdout;
  import `@anthropic-ai/sdk`; know about SDK request/response shapes;
  contain any Echo-specific branching beyond calling `resolveWorkspace(id)`
  generically (the only Echo-specific code lives in `echoWorkspace.ts`).

## 6. Workspace resolution

| | Direct exported constant | Simple in-memory map (recommended) | Registry class |
|---|---|---|---|
| Exercises "unknown workspace" honestly | No — there's nothing to look up, `workspaceId` would be decorative | Yes — a real lookup with a real miss case | Yes, but with unnecessary machinery |
| Matches PROJECT_RULES rule 11 ("stays minimal... until a second workspace exists") | Understates the boundary M0 is supposed to prove | Matches exactly | Overshoots — implies runtime registration nothing in M0 needs |
| State/lifecycle | None | None (a literal built at module load) | Instance state, registration order, possible singleton concerns |
| Cost to add a second workspace later | Requires restructuring away from a constant | Add one more file + one more map entry | Already "supports" it, at a cost paid up front for no current benefit |

**Decision:** a simple in-memory map — one plain object literal
(`{ echo: echoWorkspace }`) plus a one-line lookup function
(`resolveWorkspace(id) => map[id]`). This is the smallest mechanism that
still proves real resolution, including the not-found path, without
inventing registration/lifecycle machinery nothing in M0 uses. Model/provider
selection is never part of this map — a `WorkspaceDefinition` has no
provider- or model-related field (Section 5).

**Evolution path:** when a second real workspace exists, it is one more
file under `workspaces/` and one more map entry — no code shape change. If
a real need for *dynamic* registration (filesystem discovery, a manifest
format, runtime plugin loading) appears later, that is the point to
introduce a registry/loader — not before, per Architecture.md's explicit
instruction not to build a plugin loader ahead of need.

## 7. CLI contract

```
npm run agent -- --workspace <id> --input "<text>" [--provider fake|anthropic] [--simulate-failure]
```

Argument parsing uses Node's built-in `node:util` `parseArgs` (stable since
Node 20) — four flat flags need nothing heavier (see Section 11 for why
`commander`/`yargs` are deliberately not added).

- **Required:**
  - `--workspace <id>` — which workspace to invoke. Only `echo` resolves in
    M0; any other value is a valid *request* that resolves to
    `WORKSPACE_NOT_FOUND`.
  - `--input <text>` — the user input string.
- **Optional:**
  - `--provider <fake|anthropic>` — default **`fake`**, so the default path
    always works offline with no configuration. There is no model-selection
    flag — model choice is not CLI-configurable in M0 (Section 5/8).
  - `--simulate-failure` — boolean flag; only meaningful with the fake
    provider. If combined with `--provider anthropic`, this is a **CLI
    usage error** (exit code 2) — not a domain error — since the
    combination only makes sense for testing the fake path.
- **stdout:** on success, exactly the `output` string plus a trailing
  newline — nothing else. Keeps the happy path scriptable.
- **stderr:** on failure, exactly one line: `` Error [<code>]: <message> ``.
  Never the `cause`, never a stack trace, never a secret.
- **Exit codes:**
  - `0` — success.
  - `1` — a recognized `AgentOsError` occurred, or an unexpected exception
    was caught at the CLI boundary (printed as
    `Error [UNEXPECTED]: an unexpected error occurred` — a CLI-presentation
    label only, not part of `AgentOsErrorCode`).
  - `2` — CLI usage error (missing required flag, unknown flag, or the
    `--simulate-failure` + `--provider anthropic` combination above).
- **Unknown workspace:** use case returns `WORKSPACE_NOT_FOUND` → exit 1.
- **Missing `--input` flag entirely:** usage error → exit 2 (caught at
  parse time, before the use case runs).
- **`--input ""` (flag present, empty value):** forwarded to the use case,
  which returns `INVALID_INPUT` → exit 1 (a domain validation, not a usage
  error, since the flag was syntactically present).
- **Fake provider failure (`--simulate-failure`):** use case returns
  `PROVIDER_ERROR` → exit 1, stderr shows
  `Error [PROVIDER_ERROR]: The fake provider was configured to fail.`.
- **Anthropic selected without an API key:** the CLI composition root checks
  `process.env.ANTHROPIC_API_KEY` *before* dynamically importing or
  constructing `AnthropicAIProvider`; if absent, it produces
  `PROVIDER_MISCONFIGURED` directly (neither the adapter module nor the SDK
  is ever loaded) → exit 1, stderr shows
  `Error [PROVIDER_MISCONFIGURED]: ANTHROPIC_API_KEY is not set`.
- **`--provider anthropic` selected with a key present:** only at this point
  does the composition root `await import("../providers/AnthropicAIProvider.js")`
  (Section 12) — the default (`fake`) path never triggers this import.

No interactive prompts exist in M0 — every input arrives via flags.

## 8. Configuration and secrets

- The application use case never touches `process.env` (Section 5).
- The **CLI composition root** (`src/cli/index.ts`) is the only place that
  reads `process.env.ANTHROPIC_API_KEY`, and only when `--provider anthropic`
  was selected — it passes the value explicitly into `AnthropicAIProvider`'s
  constructor. **M0 exposes only `ANTHROPIC_API_KEY`** — there is no
  `ANTHROPIC_MODEL` (or any other) environment variable, and the CLI never
  reads or exposes one.
- **No `.env` loader dependency:** Node 24 has native `--env-file`/
  `--env-file-if-exists` support. The `smoke:anthropic` script (Section 10)
  invokes with `--env-file-if-exists=.env`, so a missing `.env` does not
  cause Node to fail before Agent OS's own code runs — a missing
  `ANTHROPIC_API_KEY` is still handled safely as `PROVIDER_MISCONFIGURED`
  either way. The default `agent`/`test` scripts never load `.env` at all,
  since the fake-provider path (and the offline `AnthropicAIProvider` unit
  tests) need no environment configuration.
- **`.env.example` should exist:** yes — containing exactly
  `ANTHROPIC_API_KEY=` (empty, commented) and nothing else — no
  `ANTHROPIC_MODEL` entry. Not created in this task.
- **`.gitignore`:** must include `.env` at implementation time (the file
  already exists in the repo and needs this one entry added — not modified
  in this design-only task).
- **Missing configuration reported safely:** exactly the
  `PROVIDER_MISCONFIGURED` path in Section 7 — a clear message, never an
  echoed secret value, never a raw SDK error.
- **No broad `Config` service:** env reading is a few inline lines in the
  CLI composition root; nothing in M0 justifies a generalized configuration
  abstraction.

## 9. Testing plan

| # | Test | Level | Subject | Substituted | Expected result |
|---|---|---|---|---|---|
| 1 | Execute-workspace success with Echo + FakeAIProvider | unit | `executeWorkspace` | `FakeAIProvider` (success mode), real `resolveWorkspace`/`echoWorkspace` | `{ ok: true, output: "Echo: <input>" }` |
| 2 | Provider failure is normalized correctly | unit | `executeWorkspace` | `FakeAIProvider` (failure mode) | `{ ok: false, error: { code: "PROVIDER_ERROR", retryable: false, ... } }`, no exception thrown |
| 3 | Unknown workspace | unit | `executeWorkspace` | `FakeAIProvider` (should never be called) | `{ ok: false, error: { code: "WORKSPACE_NOT_FOUND" } }`; assert `generate` was never invoked |
| 4 | Empty or invalid input | unit | `executeWorkspace` | `FakeAIProvider` (should never be called) | `{ ok: false, error: { code: "INVALID_INPUT" } }` for `""`/whitespace-only input; `generate` never invoked |
| 5 | Echo workspace instructions are included in the provider-neutral request | unit | `executeWorkspace` | A recording `FakeAIProvider` (`vi.fn`-wrapped `generate`) | The recorded `AIProviderRequest.instructions` equals `echoWorkspace.instructions` exactly |
| 6 | Application use-case tests do not require CLI or `process.env` | structural/unit | `executeWorkspace.test.ts` as a whole | n/a | No test in this file imports `src/cli/*` or reads `process.env`; true by construction, reviewed at each checkpoint |
| 7 | `AnthropicAIProvider` request translation | unit, offline | `AnthropicAIProvider` | injected fake `fetch` recording the outgoing request | Recorded body has `system` = the request's `instructions`, one user message = the request's `input`, `model` = `DEFAULT_ANTHROPIC_MODEL`, `max_tokens` = 1024; zero network calls |
| 8 | `AnthropicAIProvider` response normalization | unit, offline | `AnthropicAIProvider` | injected fake `fetch` returning a canned success body with multiple `text` content blocks | `{ ok: true, output }` where `output` is the concatenated text; no Anthropic response object or field escapes through the returned value |
| 9 | `AnthropicAIProvider` transient failure translation | unit, offline | `AnthropicAIProvider` | injected fake `fetch` returning 429/500/529 bodies, and separately rejecting/throwing to simulate timeout/connection failure | Each case normalizes to `{ ok: false, error: { code: "PROVIDER_UNAVAILABLE", retryable: true } }` |
| 10 | `AnthropicAIProvider` permanent failure translation | unit, offline | `AnthropicAIProvider` | injected fake `fetch` returning 400/401/403-class bodies | Normalizes to `{ ok: false, error: { code: "PROVIDER_ERROR", retryable: false } }` |
| 11 | `AnthropicAIProvider` safety | unit, offline | `AnthropicAIProvider` | injected fake `fetch` returning an error body containing a fake secret/prompt fragment | The resulting `AgentOsError.message` contains none of: the raw response body, the API key, a stack trace; any `cause` is present only internally and is never asserted as part of the public message |
| 12 | CLI success path uses FakeAIProvider and returns exit code 0 | end-to-end | `src/cli/index.ts` (real spawned process) | none — real default (`fake`) path | exit code `0`; stdout is the expected deterministic output; stderr empty |
| 13 | CLI failure path writes a safe message and returns a nonzero exit code | end-to-end | `src/cli/index.ts --simulate-failure` (real spawned process) | none | exit code `1`; stderr matches `Error [PROVIDER_ERROR]: ...`; stdout empty; no stack trace or `cause` text present |
| 14 | Fake CLI path does not load the Anthropic adapter | structural/design invariant | `src/cli/index.ts` | n/a | `AnthropicAIProvider` is referenced exactly once, inside the dynamic `import()` guarded by `provider === "anthropic"` — verified by inspection/grep, not a runtime module-load-tracking test (impractical for M0; see Section 9 note below) |
| 15 | Default automated tests make no network calls | structural/design invariant | the whole default `vitest run` suite | n/a | **Default automated tests may import `AnthropicAIProvider`, but all such tests inject deterministic transport behavior (a fake `fetch`) and make zero real network calls.** This replaces the earlier, stricter claim that no test file imports it at all — the adapter is now exercised offline by design |
| 16 | Anthropic live smoke test is opt-in and excluded from the default test command | manual smoke test | `AnthropicAIProvider`, via `npm run smoke:anthropic` | none — real SDK, real key, real network | succeeds only with a valid `ANTHROPIC_API_KEY` and network access; never runs under `npm test` or any CI configured so far |

Note on item 14: intercepting ESM dynamic `import()` calls at runtime (e.g.
via a custom loader) to *prove* the fake path never loads the module is
disproportionate machinery for M0. The invariant is instead enforced by
keeping the import structurally singular and conditional (Section 12) and
verified by inspection — "where practical," per instructions, this is a
structural check, not a fabricated runtime assertion.

No snapshot tests are used anywhere in this matrix — every assertion is an
explicit shape/value check, which is clearer for a result union this small.

## 10. Package scripts and validation commands

Proposed `package.json` `"scripts"` (not created in this task):

```json
{
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "agent": "tsx src/cli/index.ts",
  "smoke:anthropic": "node --env-file-if-exists=.env --import=tsx src/cli/index.ts --provider anthropic"
}
```

`smoke:anthropic` invokes `node` directly (with `--import=tsx` loading the
same TypeScript/ESM support the `tsx` binary wraps) rather than the `tsx`
binary used by `agent`, solely so it can also pass Node's own
`--env-file-if-exists=.env` flag on the same command line — both scripts
ultimately run the identical `tsx` loader. `--env-file-if-exists` (rather
than `--env-file`) is deliberate: `.env` is loaded when present, but its
absence does not cause Node to fail before Agent OS's own code runs — a
missing `ANTHROPIC_API_KEY` is still caught and reported safely as
`PROVIDER_MISCONFIGURED` by the CLI itself (Section 7/8). The default
`agent` and `test` scripts never load `.env` at all.

No `vitest.config.ts` is needed for M0: Vitest's default include glob
(`**/*.{test,spec}.ts`) already picks up every `*.test.ts` file in the tree,
including `AnthropicAIProvider.test.ts` (offline, included by default — see
Section 9) and `index.e2e.test.ts` (its longer child-process-spawn timeout
is set inline on that test, e.g. `{ timeout: 15000 }`, rather than via a
project-wide config). The Anthropic *live* smoke path is invoked only via
the `smoke:anthropic` script — it is never a Vitest test file, so there is
nothing to exclude from the default run.

Full future M0 validation sequence:

```
npm install
npm run typecheck
npm test
npm run agent -- --workspace echo --input "Hello"                       # expect exit 0
npm run agent -- --workspace echo --input "Hello" --simulate-failure    # expect exit 1
npm run smoke:anthropic -- --workspace echo --input "Hello"             # optional, manual, requires ANTHROPIC_API_KEY
git diff --check
git status --short
```

## 11. Dependency list

| Dependency | Type | Why M0 needs it | Why a built-in alternative is insufficient |
|---|---|---|---|
| `typescript` | dev | The language and its compiler; `tsc --noEmit` is the typecheck script | No built-in alternative exists for TS type-checking |
| `tsx` | dev | Runs the CLI directly from `src/` with no build step, for `npm run agent` and local iteration | Node cannot yet run this project's TS (NodeNext resolution, full type-only import handling) with zero config; a `tsc`-then-`node dist/...` build step is heavier for iterative dev and requires a `dist/` artifact directory M0 doesn't otherwise need |
| `vitest` | dev | The one test framework (Section 3) | `node:test` lacks native TS support and the future React/component-testing story the project will need at M2 |
| `@types/node` | dev | Type declarations for Node builtins (`process`, `child_process`, `node:util`, etc.) used throughout `src/` | TypeScript has no built-in knowledge of Node's runtime types; hand-rolling ambient declarations would be strictly worse |
| `@anthropic-ai/sdk` | runtime | Required by `AnthropicAIProvider` — the official SDK | Hand-rolling the Messages API's HTTP calls, retries, and types is exactly what the SDK exists to avoid; explicitly expected per instructions |

**Deliberately not included, with reasons:**

- **`dotenv`** — Node 24's native `--env-file-if-exists` flag covers the one
  script that needs it (`smoke:anthropic`); no package needed.
- **`zod`** (or any schema-validation library) — no concrete runtime
  boundary in M0 benefits from it (Section 3).
- **`commander` / `yargs`** — four flat CLI flags are within reach of
  Node's built-in `node:util` `parseArgs`.
- **`jest` / `mocha` / `chai`** — Vitest was chosen as the one test
  framework (Section 3); adding another would violate "keep the dependency
  count intentionally small."
- **A test-only HTTP mocking library (`msw`, `nock`, etc.)** — the Anthropic
  SDK accepts a custom `fetch` implementation directly via constructor
  options, so a plain hand-written fake function is sufficient (Section 5);
  a dedicated mocking library would be redundant machinery for one adapter.

Total: 4 dev dependencies, 1 runtime dependency — unchanged from the prior
design; offline adapter testing is achieved through the SDK's own
constructor-level `fetch` injection, not a new dependency.

## 12. Dependency rules

Using the file tree in Section 4:

- `src/cli/index.ts` may depend on: `executeWorkspace`, `resolveWorkspace`,
  `WorkspaceDefinition` (for wiring), `FakeAIProvider` (static import), and
  `AgentOsError` (read-only, for presentation). It depends on
  `AnthropicAIProvider` only through a single **dynamic** `import()`,
  executed exclusively inside the `--provider anthropic` branch, after the
  `ANTHROPIC_API_KEY` presence check (Section 7/9). The default (`fake`)
  path never evaluates that branch, so it never loads the adapter module or
  `@anthropic-ai/sdk` transitively.
- `src/application/executeWorkspace.ts` may depend on: `WorkspaceDefinition`
  (for the injected function's return type) and `AIProvider`/`AgentOsError`.
  It does **not** import `resolveWorkspace.ts` at all — `resolveWorkspace` is
  received as an injected function (structurally typed inline, per Section 5)
  and wired concretely only by the CLI composition root. Must **not** depend
  on the CLI, `FakeAIProvider`, or `AnthropicAIProvider` concretely.
- `src/workspaces/echoWorkspace.ts` may depend only on `WorkspaceDefinition`.
- `src/workspaces/resolveWorkspace.ts` may depend on `WorkspaceDefinition`
  and the individual workspace modules (`echoWorkspace.ts`) it maps over.
- `src/providers/FakeAIProvider.ts` and `AnthropicAIProvider.ts` may depend
  on `AIProvider` and `AgentOsError`. Only `AnthropicAIProvider.ts` may
  additionally depend on `@anthropic-ai/sdk`.
- `src/providers/AIProvider.ts` (the port) may depend only on
  `AgentOsError` — nothing else, no adapter, no CLI, no SDK.
- `src/errors/AgentOsError.ts` depends on nothing internal (a leaf module).
- The Anthropic SDK may be imported only by `AnthropicAIProvider.ts`.
  `AnthropicAIProvider.test.ts` does not need to import it either (Section 5).
- Application and workspace code (`executeWorkspace.ts`, `echoWorkspace.ts`,
  `WorkspaceDefinition.ts`, `resolveWorkspace.ts`) must not import the CLI
  or the Anthropic SDK.
- Test files may import `FakeAIProvider` and `AnthropicAIProvider` directly
  (the latter only with an injected fake `fetch`, never touching the
  network); production application code (`executeWorkspace.ts`) must not
  import either concretely — only the CLI composition root (composing the
  default offline path, and dynamically for the Anthropic path) and test
  files construct them.

**Circular dependency check:** tracing the graph above —
`AIProvider.ts → AgentOsError.ts` (leaf); `resolveWorkspace.ts → echoWorkspace.ts → WorkspaceDefinition.ts`
(leaf); `executeWorkspace.ts → WorkspaceDefinition.ts, AIProvider.ts` (not
`resolveWorkspace.ts` — that dependency is injected, not imported, per
Section 5); `FakeAIProvider.ts`/`AnthropicAIProvider.ts → AIProvider.ts, AgentOsError.ts`;
`cli/index.ts →` everything else (statically, except `AnthropicAIProvider.ts`,
which it reaches only via a runtime-conditional dynamic import). Nothing
downstream ever imports back upstream — the graph is a single-direction DAG
with no cycles, static or dynamic. No circular dependency exists in this
design.

## 13. M0 implementation sequence

1. **Scaffolding** — `package.json`, `tsconfig.json`, `.nvmrc`,
   `.env.example`, `.gitignore` entry, install the five dependencies.
   *Validation:* `npm install` succeeds; `npm run typecheck` passes on an
   empty `src/`.
2. **Leaf contracts** — `AgentOsError.ts`, `WorkspaceDefinition.ts`,
   `AIProvider.ts` (including `ProviderError`/`ProviderErrorCode`). No
   behavior yet.
   *Validation:* typecheck passes; `AIProvider.ts` imports nothing but
   `AgentOsError.ts` (reviewable in isolation, before any adapter exists).
3. **Echo workspace + resolution** — `echoWorkspace.ts`, `resolveWorkspace.ts`,
   `resolveWorkspace.test.ts`.
   *Validation:* resolution tests pass (known id resolves, unknown id
   returns `undefined`).
4. **FakeAIProvider** — success + constructor-selected failure mode,
   `FakeAIProvider.test.ts`.
   *Validation:* both modes covered by tests; zero SDK imports.
5. **Execute-workspace use case** — `executeWorkspace.ts`,
   `executeWorkspace.test.ts` covering matrix items 1–6.
   *Validation:* all five behavioral unit tests pass; use case has no CLI
   or `process.env` reference (grep-verifiable).
6. **AnthropicAIProvider (offline)** — `AnthropicAIProvider.ts` with the
   injectable-`fetch` constructor option, fixed `maxRetries: 0`/
   `timeout: 30_000`, and `AnthropicAIProvider.test.ts` covering matrix
   items 7–11.
   *Validation:* `npm test` passes with zero network calls;
   `AnthropicAIProvider.ts` remains the only file importing
   `@anthropic-ai/sdk` (grep-verifiable).
7. **CLI composition root** — `index.ts` (including the dynamic import of
   `AnthropicAIProvider` gated on `--provider anthropic`), `index.e2e.test.ts`
   covering matrix items 12–14, and `smoke:anthropic` script wiring.
   *Validation:* manual `npm run agent -- --workspace echo --input "Hello"`
   works; e2e tests pass; the manual `smoke:anthropic` path is documented
   but not required to pass.
8. **Final validation pass** — run the full sequence in Section 10 end to
   end; write the short post-M0 architecture review note that Roadmap.md's
   M0 exit criteria require (a separate follow-up document, out of scope
   for this design doc).

These eight checkpoints remain the internal implementation and validation
sequence — each still produces a coherent, independently-reviewable
improvement with its own validation. They are **not**, however, the unit of
commit granularity (see the commit strategy below).

**Commit strategy:**

1. **Design commit**, after this document is approved:
   `docs: define M0 Echo walking skeleton`
2. **One implementation commit**, after the entire M0 implementation
   (checkpoints 1–8 above) and all validation in Section 10 pass:
   `feat: implement Echo walking skeleton`
3. **One post-M0 review commit**:
   `docs: record M0 architecture findings`

The eight checkpoints are **validation boundaries within that one
implementation commit** — a reviewer can still ask "show me the state after
checkpoint 2" via the working tree or a draft PR's incremental diffs during
review, but the checkpoints themselves are not separately committed. This
keeps `main`'s history to three meaningful commits for this milestone
(design, implementation, review) rather than fragmenting a single
still-incomplete milestone across many intermediate commits. Commits are
not created in this task.

## 14. Risks and deliberate tradeoffs

| Risk | Mitigation |
|---|---|
| Overgeneralizing the workspace contract from Echo | `WorkspaceDefinition` stays at exactly `{ id, instructions }`; Architecture.md marks the shape provisional and revisited only once a second workspace exists — no speculative fields added now |
| Echo is too trivial to expose real architecture problems | Echo's instructions still travel through the full port/adapter/error path unmodified (not special-cased); the failure-path and unknown-workspace tests exercise the unhappy-path plumbing even though Echo's happy path is trivial; the post-M0 review is an explicit forcing function to flag this if it turns out true |
| Conflating provider selection with workspace behavior | Provider selection (`--provider`) is entirely a CLI/composition-root concern; `WorkspaceDefinition` never references a provider or model; the use case receives the provider as an injected dependency, never derived from the workspace |
| Premature npm workspace separation | Option A (single root package) chosen explicitly in Section 3, with the criteria for revisiting spelled out (a second real workspace needing independent packaging, or a second real cross-process consumer) |
| Provider-specific concepts leaking into the port | `AIProvider.ts` may only import `AgentOsError.ts` (Section 12); reviewable in isolation at checkpoint 2, before any adapter exists; grep-verifiable at any later point (`AnthropicAIProvider.ts` is the only file importing the SDK); the port's own `ProviderError` narrows `AgentOsErrorCode`, it doesn't widen it with anything Anthropic-specific |
| Testing only the CLI rather than the application use case | The test matrix (Section 9) requires five `executeWorkspace`-level unit tests and five `AnthropicAIProvider`-level unit tests in addition to, not instead of, the two CLI-level e2e tests — both the use case and the real adapter's translation logic must be covered without the CLI or the network |
| A live network dependency quietly creeping into the default test suite | The offline `fetch` injection point is fixed at design time (constructor option, Section 5) precisely so implementation can't reach for `nock`/real HTTP calls under time pressure; the acceptance checklist (Section 15) requires a grep-verifiable zero-network guarantee |
| Fake CLI path accidentally loading the Anthropic adapter/SDK anyway | The dynamic `import()` is gated behind the same `--provider anthropic` check used for the `ANTHROPIC_API_KEY` read (Section 7/12), and its singularity is a structural, reviewable invariant rather than an assumption |

## 15. Acceptance checklist

- [ ] `npm install` completes from a clean checkout with no errors
- [ ] `npm run typecheck` exits `0`
- [ ] `npm test` exits `0` and makes zero real network calls, including its
      `AnthropicAIProvider` tests (which run against an injected fake
      `fetch`, not the real API)
- [ ] `npm test` exercises `AnthropicAIProvider` with fake transport,
      covering request translation, response normalization, transient
      failure, permanent failure, and safety (5 of 5 present)
- [ ] `executeWorkspace` unit tests cover all of: success, provider-failure
      normalization, unknown workspace, invalid input, instructions
      pass-through (5 of 5 present)
- [ ] The CLI e2e test covers both the success path (exit `0`) and the
      simulated-failure path (nonzero exit)
- [ ] `AnthropicAIProvider.ts` is the only file under `src/` importing
      `@anthropic-ai/sdk` (verifiable via
      `grep -rl "@anthropic-ai/sdk" src/` returning exactly one file)
- [ ] `AIProvider.ts` contains no reference to any Anthropic/SDK-specific
      type (verifiable via grep)
- [ ] `src/cli/index.ts` contains exactly one reference to
      `AnthropicAIProvider`, inside a dynamic `import()` guarded by
      `--provider anthropic` (verifiable by inspection) — the fake CLI path
      never loads that module
- [ ] `AnthropicAIProvider`'s SDK client construction sets `maxRetries: 0`
      explicitly (verifiable by inspection)
- [ ] `AnthropicAIProvider`'s SDK client construction sets
      `timeout: 30_000` explicitly (verifiable by inspection)
- [ ] `npm run agent -- --workspace echo --input "Hello"` exits `0` and
      prints deterministic output with no `ANTHROPIC_API_KEY` set
- [ ] `npm run agent -- --workspace echo --input "Hello" --simulate-failure`
      exits nonzero and prints exactly one safe stderr line
- [ ] `npm run agent -- --workspace does-not-exist --input "Hello"` exits
      nonzero with `WORKSPACE_NOT_FOUND`
- [ ] `npm run agent -- --workspace echo --input ""` exits nonzero with
      `INVALID_INPUT`
- [ ] `npm run agent -- --workspace echo --input "Hello" --provider anthropic`
      with no `ANTHROPIC_API_KEY` set exits nonzero with
      `PROVIDER_MISCONFIGURED` and prints no stack trace
- [ ] Running `smoke:anthropic` with no `.env` file present does not crash
      before Agent OS's own `PROVIDER_MISCONFIGURED` handling runs
      (`--env-file-if-exists` behaves as expected)
- [ ] `ANTHROPIC_MODEL` does not appear anywhere in the implementation's
      configuration surface — no env var read, no CLI flag, no
      `.env.example` entry (verifiable via grep)
- [ ] `npm run smoke:anthropic` is documented, is not invoked by `npm test`,
      and is not part of any CI configuration (none exists yet)
- [ ] No script or source file references React, Vite, Express, HTTP
      routes, SQLite, Postgres, or any persistence/tool/memory/planner/
      reviewer module
- [ ] No physical `kernel/` or `runtime/` package or directory exists
- [ ] No `shared/` package exists
- [ ] The repository contains exactly one npm package (root) — no
      `packages/*` workspace directories
- [ ] `git diff --check` reports no whitespace errors on the implementation
      diff

## 16. Open decisions

Everything architecturally load-bearing is resolved above. What remains
open is process/tuning only, and none of it blocks starting implementation:

- **`max_tokens` default (1024) for `AnthropicAIProvider`:** a tunable
  constant, adjustable without any contract change.
- **CI wiring (GitHub Actions or similar):** neither Architecture.md nor
  Roadmap.md require CI to exist for M0, only that the validation commands
  in Section 10 be runnable locally. Recommend deferring actual CI
  configuration to M1 unless requested sooner.
- **Exact copy of each safe CLI error message:** the shape (`code`,
  `message`, `retryable`, optional `cause`) is fixed; final message wording
  can be polished during implementation with no architectural impact.

Commit granularity (previously open) is now resolved by Section 13's
three-commit strategy and is no longer an open decision.
