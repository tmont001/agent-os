# ADR 0002 — Agent OS Error Ownership

## Status

Accepted

## Context

Agent OS's execution path crosses three distinct layers before a result
reaches a caller: the application use case (`executeWorkspace`), the
composition/input adapter that wires dependencies together (the CLI's
`src/cli/index.ts`, and now an HTTP composition root), and the provider
adapter that actually talks to a model (`FakeAIProvider`,
`AnthropicAIProvider`). If any layer could construct any error code, the
system would lose the ability to reason about who is responsible for
preventing or handling a given failure category. Concretely: a provider
adapter that could claim `INVALID_INPUT` could mask a real validation bug as
a provider hiccup; a composition root that could claim a provider-owned code
could report a configuration mistake as if the remote API had failed. Either
way, ownership by convention alone — rather than by the type system — would
make the failure category untrustworthy the moment a second contributor
touches the code.

## Decision

Error ownership is split by layer, and enforced at the type level, not by
convention:

**Application use case** (`src/application/executeWorkspace.ts`) owns:
- `INVALID_INPUT` — user input is empty or whitespace-only.
- `WORKSPACE_NOT_FOUND` — the requested workspace id does not resolve.

**Composition/input adapter** (currently `src/cli/index.ts`) owns:
- `PROVIDER_MISCONFIGURED` — e.g., the Anthropic provider was selected but no
  API key is available. This is constructed by the composition root itself,
  before a provider adapter is even instantiated.

**Provider adapters** (`FakeAIProvider`, `AnthropicAIProvider`) own, and may
construct **only**:
- `PROVIDER_UNAVAILABLE` — a transient failure (rate limit, server error,
  connection/timeout failure); `retryable: true`.
- `PROVIDER_ERROR` — any other provider-side failure; `retryable: false`.

This restriction is enforced by the `ProviderErrorCode` type in
`src/providers/AIProvider.ts`, which narrows `AIProviderFailure.error` to
exactly these two codes — a provider adapter is structurally incapable of
returning `INVALID_INPUT`, `WORKSPACE_NOT_FOUND`, or
`PROVIDER_MISCONFIGURED`, because the TypeScript type does not permit it.

Also recorded:

- **Expected failures are returned through discriminated unions**
  (`AIProviderResult`, `ExecuteWorkspaceOutput`), never thrown. A caller must
  check `.ok` and is forced by the type system to handle the failure branch.
- **Unexpected programming failures remain thrown exceptions.**
  `AnthropicAIProvider.generate` explicitly rethrows any error it does not
  recognize (`throw error;`) rather than normalizing it into a generic
  `PROVIDER_ERROR` — a genuine bug must not be silently absorbed into a
  "handled" result. The CLI's outer `main().catch(...)` is the safety net
  that turns any such escaped exception into a safe, generic response,
  without ever inspecting or exposing it.
- **Public adapters expose only safe `code`/`message` (and `retryable`) data.**
  The CLI's `agentError`/`unexpectedError` functions render exactly
  `code` and `message` — never `cause`.
- **Internal `cause` values never cross a public transport boundary.**
  `AgentOsError.cause` exists for local diagnostics only.
  `AnthropicAIProvider.test.ts` includes a dedicated safety test asserting
  that a raw provider error body, an API key, and stack-trace-shaped text
  never appear in the public `message` field.

## Consequences

**Positive:**
- Ownership is compiler-enforced, not just documented — a provider adapter
  cannot accidentally (or through a future contributor's mistake) claim an
  application- or composition-owned code.
- Tests can assert "the provider was never called" cleanly (e.g.,
  `executeWorkspace.test.ts`'s unknown-workspace and invalid-input cases),
  because validation failures are guaranteed to originate before the
  provider boundary.
- Public rendering is safe by construction: because provider adapters can
  only ever produce two codes with fixed, pre-written safe messages, there is
  no path by which a raw error body or secret can end up in `message`.
- Discriminated unions force exhaustive handling of expected failures at
  compile time, while explicit rethrowing keeps unexpected bugs visibly
  distinct from expected ones.

**Negative / limitations:**
- Five fixed codes are coarse once a transport layer needs to map errors to
  something more granular than "safe text" — for example, an HTTP adapter
  must decide which HTTP status each code maps to (is `PROVIDER_UNAVAILABLE`
  a 503? is `WORKSPACE_NOT_FOUND` a 404?). This mapping does not exist yet;
  it is exactly what M1 is responsible for defining, not a flaw in this
  model.
- `retryable` is a boolean, not a structured retry hint (e.g., a
  retry-after duration). Nothing in M0 or M1 demonstrates this is
  insufficient; it is left as-is rather than speculatively enriched.

## Alternatives considered

**Throwing every failure.** Rejected: blurs expected failures (a provider
rate limit) and unexpected ones (a bug) into the same `catch` mechanism,
making it easy to accidentally swallow a real defect as "just another
handled error."

**One unrestricted error union that every layer can construct.** Rejected:
removes the compiler's ability to prevent a provider adapter from claiming an
application- or composition-owned code (or vice versa). Ownership would then
depend entirely on convention and code review, exactly the failure mode this
decision exists to prevent.

**Returning raw provider errors.** Rejected: would leak Anthropic SDK types
and response bodies — potentially including request/response content or
header text referencing credentials — directly to callers, violating the
public error-safety boundary that M0's tests and this ADR both depend on.

## Evidence

- `src/errors/AgentOsError.ts` — the five-code union and the `AgentOsError`
  shape (`code`, `message`, `retryable`, optional `cause`).
- `src/providers/AIProvider.ts` — the narrower `ProviderErrorCode`/
  `ProviderError` types restricting adapters to two codes.
- `src/application/executeWorkspace.ts` — constructs `INVALID_INPUT` and
  `WORKSPACE_NOT_FOUND` directly; passes provider failures through unchanged.
- `src/cli/index.ts` — constructs `PROVIDER_MISCONFIGURED`; renders only
  `code`/`message` in `agentError`/`unexpectedError`; never reads `.cause`.
- `src/providers/AnthropicAIProvider.ts` — the transient/permanent/rethrow
  three-way error classification.
- `src/application/executeWorkspace.test.ts`,
  `src/providers/AnthropicAIProvider.test.ts` (including the dedicated safety
  test), `src/cli/index.e2e.test.ts` — automated evidence that the ownership
  split and safety guarantees hold.
- `docs/reviews/M0_ARCHITECTURE_REVIEW.md`, Section 4 ("Provider-error vs.
  application-error ownership") and Section 9.

This ADR fixes the five existing codes (`INVALID_INPUT`, `WORKSPACE_NOT_FOUND`,
`PROVIDER_MISCONFIGURED`, `PROVIDER_UNAVAILABLE`, `PROVIDER_ERROR`) as the
codified set. It does not introduce a larger error taxonomy, and none is
anticipated.

**On M1 and future transports:**

- **M1 (the HTTP boundary) does not add any `AgentOsErrorCode` values.** The
  five codes above are unchanged by M1.
- Failures that originate purely at the HTTP transport boundary — malformed
  JSON, an unknown route, an unsupported method, a body that fails shape
  validation before it would even reach `executeWorkspace` — are **not**
  `AgentOsError`s at all. They are represented by a separate,
  transport-local error code type scoped to `src/http/` (defined in
  `docs/milestones/M1_DESIGN.md`), because they are not application-domain
  failures and have no owner among `executeWorkspace`, the composition root,
  or a provider adapter as described above.
- **HTTP adapters map `AgentOsError`s to HTTP responses; they do not mutate
  or broaden them.** An HTTP adapter reads `code`/`message`/`retryable` off
  an existing `AgentOsError` to decide a status code and response body — it
  never adds fields to `AgentOsError`, never invents a sixth
  `AgentOsErrorCode`, and never re-labels one of the five existing codes as
  something else.
- **This set of five codes is not forbidden from ever growing.** A future,
  concrete need (backed by real evidence, the same evidentiary standard this
  ADR itself was held to) may justify a sixth code someday. That would
  require updating this ADR or writing a superseding ADR — it is not a
  decision any future contributor should make silently by just adding a
  string to the union. Any new transport (HTTP now, others later) is
  expected to *map* the existing codes to its own conventions, not to invent
  new Agent OS error codes on its own authority.
