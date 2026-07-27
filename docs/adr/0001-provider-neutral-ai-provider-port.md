# ADR 0001 — Provider-Neutral AIProvider Port

## Status

Accepted

## Context

Agent OS must not let application code depend directly on Anthropic SDK
types. If `executeWorkspace` (or any future use case) called
`@anthropic-ai/sdk` directly, swapping or adding a provider would require
rewriting business logic, and vendor-specific request/response/error shapes
would leak into code that should reason only in Agent OS's own terms. This
was a stated goal before M0 (Vision.md, Architecture.md) but was unvalidated
until M0 produced real evidence.

**What M0 implemented:** `src/providers/AIProvider.ts` defines a
provider-neutral port — `AIProviderRequest { instructions, input }`, a
`AIProviderResult` discriminated union, and a narrow `ProviderError` type
restricted to two codes. Two independent implementations exist:
`src/providers/FakeAIProvider.ts` (deterministic, offline, no imports beyond
the port) and `src/providers/AnthropicAIProvider.ts` (the only file in the
repository that imports `@anthropic-ai/sdk`). `src/application/executeWorkspace.ts`
depends only on the `AIProvider` interface, never a concrete adapter.

**What evidence M0 produced:**
- `grep -RIn '@anthropic-ai/sdk' src` returns exactly one match:
  `src/providers/AnthropicAIProvider.ts`. Even that file's own test,
  `AnthropicAIProvider.test.ts`, does not import the SDK — it injects a
  plain function matching the Fetch API signature into the SDK client's own
  `fetch` option.
- `src/providers/AIProvider.ts` imports only `AgentOsError` — nothing
  provider-specific.
- `src/application/executeWorkspace.ts` imports only `AIProvider`,
  `AgentOsError`, and `WorkspaceDefinition` (all types); it never imports
  `FakeAIProvider` or `AnthropicAIProvider`.
- 32 automated tests pass with zero network access, including 11 tests in
  `AnthropicAIProvider.test.ts` that exercise the real adapter's request
  translation, response normalization, and error classification against a
  simulated-but-SDK-realistic transport (see ADR context in
  `docs/reviews/M0_ARCHITECTURE_REVIEW.md`, Sections 3–4).

**Why one implementation would not have been enough evidence:** an interface
with a single implementer proves nothing about whether the abstraction is
real — nothing forces the boundary to be honest if there is only ever one
thing behind it. It took building `FakeAIProvider` *and* `AnthropicAIProvider`
independently, both passing the same port's contract and the same
`executeWorkspace` tests, to demonstrate that application code does not
accidentally assume Anthropic-specific behavior. This is exactly the
evidence recorded in the M0 architecture review (`docs/reviews/M0_ARCHITECTURE_REVIEW.md`,
Section 9: "Provider-neutral `AIProvider` port — Validated").

**Why LangChain or a provider framework was not needed:** M0's actual
requirement was "send instructions and input, get text or a normalized error
back" — one method, no chains, no memory, no tool-calling, no multi-turn
conversation. A general orchestration framework would import its own large
surface area (chains, agents, memory, retrievers) for a one-method
requirement, and that surface area would have to be reasoned about and mostly
ignored rather than obscuring the one boundary M0 needed to prove.

## Decision

- Application code (`executeWorkspace` and any future use case) depends on
  `AIProvider`, never on a concrete adapter or a provider SDK.
- `AIProvider` (`src/providers/AIProvider.ts`) contains only Agent OS's own
  types: `AIProviderRequest`, `AIProviderResult`, `ProviderError`. It must
  never import or expose an Anthropic SDK type.
- Concrete provider adapters (`FakeAIProvider`, `AnthropicAIProvider`, and any
  future adapter) implement `AIProvider`.
- Production Anthropic SDK imports are confined to the Anthropic adapter
  boundary, currently implemented by `src/providers/AnthropicAIProvider.ts`.
  This is phrased as a boundary, not a single permanent file, so that adapter
  can grow into more than one internal module later (e.g., if request
  translation and response parsing were ever split apart) without that
  growth being read as a violation of this decision — the invariant is "the
  Anthropic SDK stays inside the Anthropic adapter," not "the Anthropic SDK
  stays inside exactly one named file forever."
- Automated tests may exercise real adapters through injected offline
  transport (e.g., a custom `fetch` passed to the Anthropic SDK client) —
  this validates the adapter's actual translation logic without a network
  call, rather than replacing the adapter with a hand-written mock.
- Live provider smoke tests (a real network call against the real API with a
  real key) remain opt-in, excluded from the default automated test command.

**Enforcement mechanisms (two different ones, not one).** This decision is
upheld by two distinct mechanisms, and they should not be conflated:

1. **The TypeScript type system** enforces the *shape* of the port itself —
   that `AIProviderFailure.error` can only ever satisfy `ProviderErrorCode`
   (a provider adapter cannot construct an error with, say, `INVALID_INPUT`;
   the compiler rejects it), and that anything implementing `AIProvider`
   must satisfy its declared signature. This is a real, compiler-checked
   guarantee.
2. **Architecture rules, code review, and structural audits** (not the
   compiler) enforce *where the Anthropic SDK import is allowed to appear at
   all*. Nothing in TypeScript stops a developer from writing
   `import Anthropic from "@anthropic-ai/sdk"` inside `executeWorkspace.ts`
   or `AIProvider.ts` — it would compile without error. What actually
   prevents this is PROJECT_RULES, the M0 architecture review's structural
   audit (`grep -RIn '@anthropic-ai/sdk' src`), and this ADR itself. The type
   system does not prevent arbitrary imports; it only prevents violating the
   shapes the port already declares.

## Consequences

**Positive:**
- Providers are swappable without touching application logic — demonstrated,
  not merely claimed, by two independent implementations passing the same
  tests.
- Non-leakage of the port's own declared shape is compiler-enforced
  (`ProviderErrorCode` narrowing); non-leakage of *where the SDK import
  lives* is mechanically re-verifiable by `grep` and structural audit, not
  dependent on convention alone even though it isn't compiler-enforced (see
  "Enforcement mechanisms" above).
- The default test suite stays fast, deterministic, and network-free by
  construction, since `FakeAIProvider` implements the identical interface.
- The error-normalization seam — translating a provider-specific failure
  into one of the two provider-owned codes defined by
  [ADR 0002](0002-agent-os-error-ownership.md) (`PROVIDER_UNAVAILABLE` /
  `PROVIDER_ERROR`) — has one clear place to live: inside each adapter, at
  the port boundary.

**Negative:**
- Some duplication of "what does a request/response look like" reasoning
  exists between the port and each adapter's own translation logic — this is
  the necessary cost of the abstraction, not avoidable without it.
- The port's shape (`instructions`/`input` in, `output` string or error out)
  is deliberately minimal and will need to change if a genuinely different
  capability (streaming, tool calls, multi-turn conversation) is ever
  required — not a present cost, but a real one to revisit if/when that
  happens.
- Two adapters exist to maintain instead of one direct integration.

## Alternatives considered

**Anthropic SDK used directly by `executeWorkspace`.** Rejected: would make
swapping providers require rewriting the use case, would make
deterministic/offline testing of the use case impossible without a heavy
mock of the SDK itself, and would leak SDK-specific error types into
application error handling — directly contradicting the boundary this
milestone existed to prove.

**A generic third-party orchestration framework (e.g., LangChain).**
Rejected: brings an entire abstraction surface (chains, agents, memory,
tools, retrievers) that M0 never needed for a one-method requirement. Using
one would have meant importing and mostly ignoring that surface area, adding
a large dependency for zero present payoff, and obscuring rather than
demonstrating the actual boundary being tested.

**Mocking the Anthropic adapter completely instead of testing its
translation offline.** Considered and rejected: replacing the whole adapter
with a hand-written mock in tests would prove nothing about whether the real
adapter's request-building, response-parsing, and error-classification logic
is actually correct. M0 instead injected a fake `fetch` at the SDK's own
extension point (`AnthropicAIProviderOptions.fetch`), which exercises the
adapter's real logic while keeping every test network-free — evidenced by
the 11 tests in `AnthropicAIProvider.test.ts` (request translation, response
normalization including multi-block concatenation, 429/500/529/connection-
failure → `PROVIDER_UNAVAILABLE`, 400/401/403 → `PROVIDER_ERROR`, and a
dedicated safety test).

## Evidence

- `src/providers/AIProvider.ts` — the port interface and `ProviderError`
  narrowing.
- `src/providers/FakeAIProvider.ts`, `src/providers/FakeAIProvider.test.ts`.
- `src/providers/AnthropicAIProvider.ts`,
  `src/providers/AnthropicAIProvider.test.ts` (11 tests).
- `src/application/executeWorkspace.ts` — depends only on the port type.
- `docs/reviews/M0_ARCHITECTURE_REVIEW.md`, Sections 3, 4, and 9 — re-run,
  re-verified structural evidence (grep results, test counts) that the SDK is
  imported nowhere outside `AnthropicAIProvider.ts`.

This ADR does not assume or require that Agent OS will support additional AI
providers beyond Anthropic. No second real provider is planned. The value of
this decision is demonstrated entirely by the fake/real pair that already
exists, not by an anticipated future roster of providers.
