# Architecture

Status: provisional. This document records architectural decisions agreed upon
before M0 implementation begins. It will be revised after the M0 walking
skeleton provides evidence — several relationships described below are
explicitly marked open/unvalidated rather than settled.

## Kernel and Runtime: provisional vocabulary only

"Kernel" and "Runtime" are useful shorthand for two concerns any agent system
eventually has to address — orchestration/planning versus execution mechanics.
They are provisional **vocabulary**, not a validated dependency structure or
package layout. Concretely:

- Nothing in this document mandates a "Kernel → Runtime" interface or
  dependency direction. That relationship has not been validated by any
  working code yet.
- M0 does not build a kernel package or a runtime package. It builds a single,
  minimal vertical slice, described below in neutral application-architecture
  terms.
- Whether orchestration and execution mechanics end up as separate
  modules/packages — and, if so, which depends on which through an interface —
  is left open until M0 provides evidence one way or the other. See
  "Provisional / open" below.

## M0 vertical slice

The first walking skeleton is described in neutral terms, not kernel/runtime
terms:

```
input adapter → application use case → workspace resolution
  → AIProvider port → provider implementation → normalized result
  → output adapter
```

- **input adapter** — the entry point that receives a request. M0 uses a CLI
  adapter; an HTTP adapter (Express) follows later, once the application
  boundary is proven.
- **application use case** — the core logic that carries out the request. If
  orchestration concerns need to be separated from execution mechanics later,
  this is where that split would first appear.
- **workspace resolution** — looking up the requested workspace (M0 has
  exactly one: the **Echo reference workspace**) and reading its
  domain-specific instructions/configuration.
- **AIProvider port** — the provider-neutral interface the application calls
  to get a model response. It defines only Agent OS's own request, response,
  and error types, and must never import a provider SDK.
- **provider implementation** — a concrete adapter behind that port: the
  `FakeAIProvider` adapter (default, used in automated tests) or the
  `AnthropicAIProvider` adapter (optional, manually-triggered smoke test
  only — the only module allowed to import the Anthropic SDK).
- **normalized result** — the provider's response (or error) translated into
  the application's own result/error shape — never a raw provider type.
- **output adapter** — returns the result back through the input adapter
  (e.g., CLI stdout).

M0 does not require planning, a kernel decision, a runtime package, or a tool
call — none of those are needed to prove this vertical slice, so none are
built until a concrete need appears.

## Ownership: Agent OS core vs. workspace

To keep the workspace boundary honest as soon as more than one workspace
exists, ownership is split explicitly:

| Agent OS (core) owns | A workspace owns |
|---|---|
| Execution lifecycle | Domain-specific instructions and behavior |
| Workspace registration/resolution mechanism | Domain-specific tool selection/configuration |
| AI provider invocation | Workspace-specific policies |
| Provider-error normalization | Domain-specific validation and result interpretation |
| Cross-cutting logging and configuration | Domain-specific metadata |
| Tool execution infrastructure (once tools exist) | |
| Public transport adapters | |
| Run-level identifiers and generic execution results | |

A workspace must **not**:

- Import the Anthropic SDK (or any provider SDK) directly.
- Own generic execution lifecycle logic.
- Write directly to unrelated workspace storage.
- Define transport-specific (e.g., HTTP) behavior.
- Bypass the AIProvider port or tool-execution boundary.

### Workspace contract (provisional)

M0 needs only enough of a contract for the Echo reference workspace to exist —
not a plugin framework. The shape below is provisional and expected to change
once a second workspace exists to test it against:

```ts
// Provisional — will change after M0. Not a finalized public API.
interface WorkspaceDefinition {
  id: string;
  instructions: string;
  // additional domain-specific config: shape TBD, driven by what
  // the Echo workspace and any second workspace actually need.
}
```

Do not design an elaborate plugin/registration framework ahead of this need.

## Interfaces: only at meaningful boundaries

Interfaces/abstractions are introduced only where a real boundary exists —
somewhere two implementations plausibly differ, or a dependency needs to be
inverted. The AIProvider port qualifies: a `FakeAIProvider` adapter and an
`AnthropicAIProvider` adapter both exist from M0 onward, so the interface is
real, not speculative. Most internal classes do not warrant an interface.

## Build order: backend before frontend

The backend/headless execution path is built first, and must be runnable and
useful (via CLI) with zero UI attached. The frontend (React) is added
afterward as a consumer of the backend's public transport API — not a
special first-class client with access to internals.

Rationale: if the backend only works when driven by the frontend, the
boundary between them isn't real. Headless-first forces that boundary to be
honest.

## Frontend / backend contract

- Internal backend interfaces (e.g., the AIProvider port, workspace
  resolution) remain backend-only and are never imported by the frontend.
- Browser clients (the frontend, or any other HTTP client) consume the
  backend only through its **public transport API** (HTTP, or similar) —
  never backend internals.
- Frontend and backend may share transport-safe DTO schemas and
  generated/inferred types (e.g., validation schemas, request/response
  shapes) via a shared package, when one exists.
- Sharing types this way does not grant the frontend access to backend
  internals — only to the data contracts those types describe.

## `shared/` scope

`shared/` — if and when it exists — is restricted to genuinely cross-boundary
code:

- DTOs that cross a process or application boundary (e.g., backend/frontend).
- Validation schemas for those DTOs.
- Identifiers/types that both sides need to agree on.
- Transport-safe types (no server-only or client-only concerns leaking in).

**Placement rule:** a type belongs in `shared/` only when it represents an
intentional cross-process or cross-application contract. Placement is
determined by ownership and boundary semantics, **not** merely by the number
or location of current imports. Because development is backend-first, a type
being imported from only the backend today is not evidence it belongs in the
backend only — but it's also not evidence it belongs in `shared/`. The
question is always "is this a contract two sides intentionally agree on,"
not "how many places import it right now."

**M0 may not need a `shared/` package at all.** If no cross-process contract
exists yet (M0 is CLI + backend only, no frontend), don't create an empty
`shared/` package speculatively — native npm workspaces don't require
pre-creating packages ahead of need.

Backend-only interfaces and internal abstractions never go in `shared/` —
they stay in backend/core packages, even once a `shared/` package exists.

## AI provider boundary: port vs. adapters

The **AIProvider port** is a provider-neutral interface owned by the
application/core layer. It defines only Agent OS's own request, response, and
error types. It must never import the Anthropic SDK, and must never expose
Anthropic request/response types, Anthropic error types, or any other
model-specific SDK object — those would defeat the point of the port.

Concrete adapters implement that port and are the only place provider-specific
code is allowed to live:

- **`AnthropicAIProvider` adapter** — the only module allowed to import and
  use the Anthropic SDK. It translates Agent OS requests into Anthropic
  requests, translates Anthropic responses into normalized Agent OS results,
  and catches Anthropic-specific errors and translates them into Agent OS
  errors before they cross the port boundary.
- **`FakeAIProvider` adapter** — a deterministic test implementation of the
  same port. Requires no network access; used by the normal automated test
  suite and the CLI validation path.

Application/use-case code depends only on the AIProvider port — never on a
concrete adapter or the Anthropic SDK directly. This is the one interface
introduced ahead of a second concrete implementation, because the seam (fake
vs. real provider) is a known, near-term need from M0 onward — not a
speculative one.

## Monorepo tooling: native npm workspaces only

The project uses native npm workspaces. No Turborepo, Nx, or additional
monorepo build-orchestration tooling. Keep the tooling surface as small as
the current number of packages justifies; revisit only if npm workspaces
become a demonstrated bottleneck.

## Error model (minimal)

An error crossing an internal architectural boundary (e.g., provider
implementation → AIProvider port → application use case → output adapter)
carries at minimum:

- A stable, machine-readable code.
- A safe, human-readable message.
- A retryable indicator (or equivalent classification).
- An optional internal cause, for diagnostics only.

Public adapters (CLI output, and later the HTTP transport API) must never
expose: provider-specific error bodies, stack traces, API keys, prompts
containing sensitive content, or internal causes.

The concrete class/type implementing this shape is deferred to M0 design —
this section fixes the contract's shape, not its implementation.

## Testing strategy

- The normal automated test suite must never call Anthropic or require
  network access.
- Automated tests inject a `FakeAIProvider` adapter implementing the
  AIProvider port deterministically.
- A real-Anthropic smoke test is opt-in only: excluded from the default test
  command, manually triggered.
- M0 must include both a success-path test and a provider-failure-path test
  (the fake provider returns/throws an error; verify it's normalized per the
  error model above).
- Tests should exercise the application use case directly where possible,
  without requiring the CLI adapter.
- Secrets (API keys, etc.) must never be committed, logged, or embedded in
  test fixtures.

## Dependency direction

Validated (enforced from M0 onward):

- Any HTTP/browser client → backend's public transport API only, never
  backend internals directly.
- Application use case → AIProvider port; concrete adapters (`FakeAIProvider`
  adapter, `AnthropicAIProvider` adapter) depend on that port, not the
  reverse.
- The application depends on the workspace contract to read a workspace's
  data/config; a workspace never reaches back into application internals.
- `shared/` (if/when it exists) depends on nothing else in the workspace tree.

Open / not yet validated:

- Whether orchestration and execution mechanics ("kernel"/"runtime") separate
  into distinct modules or packages, and if so, which depends on which. This
  is explicitly deferred until M0 provides evidence — see "Kernel and
  Runtime" above.

## Architectural invariants

- No browser/frontend code reaches past the backend's public transport API
  into backend internals.
- No Anthropic SDK types or calls may appear outside the `AnthropicAIProvider`
  adapter — the AIProvider port itself is provider-neutral and must never
  import or expose the SDK; a workspace must not import a provider SDK
  directly either.
- `shared/` (if it exists) contains only intentional cross-process/
  cross-application contracts — never backend-only or frontend-only logic.
- The backend/headless path never requires the frontend to function or to be
  tested.
- Automated tests never call Anthropic or require network access; a
  real-provider smoke test is opt-in only.

## Provisional / open

- Whether orchestration and execution mechanics ("kernel"/"runtime") become
  separate physical packages or remain modules within one backend package,
  and their dependency direction — deferred until M0 provides evidence.
- The exact workspace contract / TypeScript shape — provisional, revisited
  once a second workspace exists to test it against.
- Whether a `shared/` package is needed at all before a real cross-process
  contract exists.
- Persistence/storage strategy.
- Multi-provider support beyond the boundary itself.
- Concrete error class/type implementation (shape is fixed above; code isn't).

## Deferred scope (explicitly out of scope for now)

- Tool calling and tool execution infrastructure (until a workspace actually
  needs a tool).
- Additional AI providers beyond Anthropic (only the boundary is being
  built).
- Persistence and memory.
- Multi-agent execution and planning.
- Turborepo/Nx or other monorepo build tooling.
- Distributed or multi-process execution.
- Frontend implementation and the HTTP transport adapter (until the
  CLI-driven backend/headless path is proven).
- Any M1 implementation work — M1's precise scope is defined only after the
  post-M0 architecture review (see Roadmap.md).
