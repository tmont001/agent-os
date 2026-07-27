# Roadmap

Status: planning document only. No milestone below has been started.

## M0 — Walking skeleton (Echo reference workspace)

Goal: prove the M0 vertical slice in [Architecture.md](Architecture.md) with
the smallest possible end-to-end path, using a single reference workspace
named the **Echo reference workspace**.

M0 proves only:

- A headless CLI input adapter can invoke one application use case.
- The application can resolve the Echo workspace.
- The Echo workspace can supply its domain instructions/configuration.
- The application invokes an AIProvider port.
- A `FakeAIProvider` adapter can return a deterministic response through that
  port.
- An optional `AnthropicAIProvider` adapter can perform a manually-triggered
  smoke test (not part of the automated suite).
- Provider failures are translated into Agent OS's own normalized errors
  (see the error model in Architecture.md).
- The result returns through the input/output adapter back to the CLI.

M0 explicitly does **not** require:

- Tool calling.
- Persistence.
- Memory.
- Planning.
- Multi-agent execution.
- Frontend work.
- A physical kernel/runtime package split.

CLI is the first headless adapter for M0 because it's the smallest adapter
needed to validate the core execution path; Express/HTTP follows only after
the application boundary is proven this way.

### M0 exit criteria

M0 is done when all of the following hold:

- Clean dependency installation (`npm install` from a clean checkout works).
- Type-check passes.
- Automated tests pass with no network access required.
- The `FakeAIProvider` adapter success-path test passes.
- The provider-failure-translation-path test passes.
- CLI invocation works end-to-end against the `FakeAIProvider` adapter.
- The optional `AnthropicAIProvider` adapter smoke test is documented and can
  be run manually (it is not required to pass CI or be part of the default
  test command).
- No frontend, persistence, tools, memory, or planning have been added.
- A short post-M0 architecture review has been written, recording which
  boundaries (see "Provisional / open" in Architecture.md) were validated or
  disproven by building the skeleton.

## M1 — defined after the M0 architecture review

M1's precise scope is intentionally **not** fully specified yet. It is
expected to deepen the backend/headless execution path (still with zero UI
dependency) and to resolve some of what M0 leaves open — most notably
whether orchestration and execution mechanics ("kernel"/"runtime") become
separate modules, and if so, their dependency direction. But M1 is defined
in detail only after the post-M0 review, not before. Do not treat any bullet
list for M1 written before that review as binding scope.

## M2 — Frontend (high level, unscheduled in detail)

Goal: a React frontend as a consumer of the backend's public transport API.

- The frontend talks to the backend only through its public transport API
  and any shared transport-safe DTO schemas — never backend internals.
- No new backend capability is added solely to serve the frontend without
  also being exposed through the headless path first.

Detailed scope for M2 is deferred until M1 exists.

## Later / unscheduled

- Additional AI providers beyond Anthropic.
- Tool calling and tool execution infrastructure.
- Persistence/storage strategy.
- Any build-tooling escalation beyond native npm workspaces, if and when
  justified by demonstrated need.

## Explicitly deferred (not on this roadmap yet)

- Distributed/multi-node execution.
- Plugin or third-party extension system.
- Multi-provider runtime selection/config.
- Memory and multi-agent planning.
