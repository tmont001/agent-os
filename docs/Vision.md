# Vision

## What Agent OS is

Agent OS (repository: `agent-os`) is a modular AI Agent Operating System: a
substrate for defining, running, and observing agents that can plan, call
tools, and execute multi-step work, independent of any single frontend or AI
provider.

The name is aspirational, not literal — this is not a kernel-mode OS. It borrows the
"operating system" framing because the goal is to provide the same kind of stable,
provider-agnostic substrate for agents that an OS provides for processes: a
consistent way to schedule work, mediate access to tools/resources, and expose a
runtime surface that higher-level applications build on.

## Problem

Agent logic today tends to get welded to a specific frontend, a specific AI
provider's SDK, and a specific execution environment, all at once. That coupling
makes it hard to:

- Swap or add AI providers without touching business logic.
- Run the same agent logic headlessly (CI, background jobs, CLI) and behind a UI.
- Reason about where state, validation, and error handling actually live.

## Goals

- A backend/headless execution path that can run an agent end-to-end with no UI
  attached.
- A clear separation between orchestration concerns (provisionally called
  "kernel") and execution mechanics (provisionally called "runtime") — this is
  conceptual vocabulary today, not a validated package structure or dependency
  direction. See [Architecture.md](Architecture.md) for what M0 will actually
  validate.
- Anthropic/Claude-specific code confined to a dedicated adapter behind a
  provider-neutral AIProvider port, not spread through business logic.
- A frontend (React) that consumes the backend through its public transport
  API, the same way any other client would.

## Non-goals (for now)

- Multi-provider support is not being built yet — only the boundary that would
  allow it later.
- No distributed/multi-node execution model.
- No plugin marketplace or third-party extension system.
- No premature package-per-concept monorepo structure — see
  [Architecture.md](Architecture.md) for why.

## Guiding principle

Prefer a minimal, working, end-to-end skeleton over a fully speculative structure.
Structure should follow from real seams that appear as the skeleton is built, not
be designed upfront and then filled in.
