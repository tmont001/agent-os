# agent-os

Agent OS is a modular AI Agent Operating System: a substrate for defining,
running, and observing agents that can plan, call tools, and execute
multi-step work, independent of any single frontend or AI provider. It's built
with TypeScript, React, Express, and Claude.

## Status

This project is currently in the **architecture / documentation phase**. No
application code has been written yet, and no milestone has been started.
Architecture and planning decisions are being recorded before any
implementation begins.

## Approach

Agent OS follows a backend-first, walking-skeleton approach: a minimal
end-to-end backend/headless execution path is built and proven out first, with
no UI attached, before any frontend work begins. Structure (package
boundaries, interfaces, etc.) is expected to emerge from that skeleton rather
than be designed upfront.

## Planned structure (high level)

The repository will be organized as a single native npm workspace monorepo
(no Turborepo/Nx or other additional monorepo tooling). At a high level:

- A **backend** area handling orchestration and execution. "Kernel" and
  "runtime" are used informally to talk about those two concerns, but they
  are not yet a validated package split or dependency direction — the first
  milestone (M0) is what tests that, using neutral terms (input adapter →
  application use case → workspace resolution → AIProvider port → provider
  implementation → output adapter).
- A **frontend** (React) area, added after the backend/headless path exists,
  consuming the backend only through its public transport API.
- A narrowly-scoped **shared** area (if/when one is needed) limited to
  genuine cross-process contracts — not created speculatively.
- A provider-neutral **AIProvider port**, with Anthropic/Claude-specific code
  confined to its own adapter behind that port, not spread through the rest
  of the application.

The exact package layout is intentionally not finalized yet — see
[docs/Architecture.md](docs/Architecture.md) for what's decided versus still
open.

## Documentation

- [Vision](docs/Vision.md) — what Agent OS is and why it exists
- [Architecture](docs/Architecture.md) — architectural decisions, boundaries,
  and invariants
- [Roadmap](docs/Roadmap.md) — milestone plan
- [Project Rules](docs/PROJECT_RULES.md) — binding rules for all work in this
  repository
