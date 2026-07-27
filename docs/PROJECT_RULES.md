# Project Rules

These rules are binding for all work in this repository, human or agent. They
operationalize the decisions in [Architecture.md](Architecture.md). If a rule
and a convenience conflict, the rule wins — raise it for discussion instead of
quietly working around it.

## Sequencing

1. Do not begin M1 (or any implementation milestone) until the corresponding
   planning/architecture docs for it exist and have been reviewed.
2. Backend/headless execution path is built before frontend work. Frontend
   work should not begin by adding backend capability "just for the UI" —
   that capability must exist on the headless path first.
3. The M0 walking skeleton comes before deeper structure. Do not pre-create
   package structure for concepts ("kernel"/"runtime", etc.) that M0 hasn't
   yet justified.
4. M1's detailed scope is defined only after the post-M0 architecture review.
   Do not treat pre-review M1 notes as binding.

## Structure

5. "Kernel" and "Runtime" are provisional vocabulary for two concerns
   (orchestration vs. execution mechanics), not mandatory package names or a
   validated dependency direction. Do not write or enforce a rule that
   mandates a "Kernel → Runtime" interface — that relationship is
   unvalidated until M0 provides evidence. Describe the M0 vertical slice
   using neutral terms instead: input adapter → application use case →
   workspace resolution → AIProvider port → provider implementation →
   normalized result → output adapter.
6. Use native npm workspaces only. Do not introduce Turborepo, Nx, or other
   monorepo build tooling without an explicit, demonstrated need.
7. Introduce an interface/abstraction only at a meaningful boundary — a place
   where a second implementation is real or near-term (the AIProvider port
   qualifies; most internal classes do not).

## Workspace ownership

8. Agent OS (core) owns: execution lifecycle; workspace registration/
   resolution; AI provider invocation; provider-error normalization;
   cross-cutting logging and configuration; tool execution infrastructure
   (once tools exist); public transport adapters; run-level identifiers and
   generic execution results.
9. A workspace owns: its domain-specific instructions/behavior; its
   domain-specific tool selection/configuration; its own policies; its
   domain-specific validation and result interpretation; its domain-specific
   metadata.
10. A workspace must not: import the Anthropic SDK (or any provider SDK)
    directly; own generic execution lifecycle logic; write directly to
    unrelated workspace storage; define transport-specific (HTTP) behavior;
    or bypass the AIProvider port or tool-execution boundary.
11. Do not build an elaborate plugin/registration framework for workspaces.
    The workspace contract stays minimal and its exact TypeScript shape
    remains provisional until a second workspace exists to validate it
    against.

## `shared/`

12. `shared/` may contain only: DTOs that cross a process/application
    boundary, validation schemas for those DTOs, cross-boundary identifiers,
    and transport-safe types.
13. Placement in `shared/` is decided by whether something is an intentional
    cross-process/cross-application contract — not by how many places
    currently import it, and not by which side (backend/frontend) happens to
    import it today. Because development is backend-first, current import
    count is not evidence either way.
14. Backend-only interfaces and internal abstractions never go in `shared/` —
    they belong in backend/core packages.
15. Do not create a `shared/` package speculatively. If no cross-process
    contract exists yet (e.g., during M0, which has no frontend), skip
    `shared/` entirely — native npm workspaces do not require pre-creating
    empty packages.

## AI provider boundary

16. No Anthropic SDK types, calls, or response shapes may appear outside the
    `AnthropicAIProvider` adapter — the AIProvider port itself is
    provider-neutral and must never contain or expose them.
    Application/use-case code depends on the AIProvider port, never on the
    SDK directly.
17. The `AnthropicAIProvider` adapter catches provider-specific errors and
    translates them into Agent OS's own normalized error shape before they
    cross the AIProvider port — they must not leak past it.

## Frontend / backend contract

18. Internal backend interfaces (e.g., the AIProvider port, workspace
    resolution) remain backend-only; the frontend never imports them.
19. The frontend (and any other HTTP client) consumes the backend only
    through its public transport API — never backend internals.
20. Frontend and backend may share transport-safe DTO schemas and
    generated/inferred types through a shared package, when one exists.
    Sharing types does not grant access to backend internals.

## Error handling

21. Any error crossing an internal architectural boundary (provider →
    application, application → output adapter, etc.) must carry: a stable
    machine-readable code, a safe human-readable message, a retryable
    indicator (or equivalent classification), and an optional internal cause
    for diagnostics only.
22. Public adapters (CLI output, later the HTTP transport API) must never
    expose provider-specific error bodies, stack traces, API keys, sensitive
    prompt content, or internal causes.
23. The concrete error class/type implementation is deferred to M0 design;
    the shape above is fixed, the implementation isn't.

## Testing

24. The normal automated test command must never call Anthropic or require
    network access.
25. Automated tests use an injectable `FakeAIProvider` adapter implementing
    the AIProvider port.
26. A real-Anthropic smoke test must be opt-in and excluded from the normal
    test command.
27. M0 must include both a success-path test and a provider-failure-path
    test.
28. Tests should exercise the application use case directly where possible,
    without requiring the CLI adapter.
29. Secrets must never be committed, logged, or embedded in test fixtures.

## Dependency direction

30. Any HTTP/browser client → backend's public transport API only, never
    backend internals.
31. Application use case → AIProvider port; concrete adapters (`FakeAIProvider`
    adapter, `AnthropicAIProvider` adapter) depend on that port, not the
    reverse.
32. The application depends on the workspace contract to read workspace
    data/config; a workspace never reaches back into application internals.
33. `shared/` (if/when it exists) depends on nothing else in the workspace
    tree.
34. The dependency direction between orchestration and execution mechanics
    ("kernel"/"runtime"), if they end up separated at all, is open and
    explicitly deferred until M0 provides evidence — do not encode or enforce
    a direction for it ahead of that.

## Working agreement

35. Documentation produced from an architecture discussion must actually be
    committed to the repo, not left as conversation summary only — if a
    decision was agreed upon, it isn't real until it's written down here or
    in Architecture.md.
36. When in doubt about scope (deferred vs. in-scope), treat it as deferred
    and say so explicitly, rather than quietly building it.
