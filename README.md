# agent-os

Agent OS is a modular AI Agent Operating System: a substrate for defining,
running, and observing agents that can plan, call tools, and execute
multi-step work, independent of any single frontend or AI provider. It's built
with TypeScript, React, Express, and Claude.

## Status

The M0 Echo walking skeleton (see
[docs/milestones/M0_DESIGN.md](docs/milestones/M0_DESIGN.md)) has been
implemented on the `m0-echo-walking-skeleton` branch and passes local
type-checking, the automated test suite, and manual CLI validation — all
without a live Anthropic API key or network access. It has not yet been
committed, reviewed, or merged; the post-M0 architecture review described in
[docs/Roadmap.md](docs/Roadmap.md) has not been written yet.

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

## Running the M0 CLI

After `npm install`:

```
npm run typecheck
npm test
npm run --silent agent -- --workspace echo --input "Hello"
```

`--silent` suppresses npm's own script-header output, so stdout matches
exactly what the CLI itself prints (`Echo: Hello`).

`npm run agent` defaults to the offline `FakeAIProvider` and requires no
configuration. `--provider anthropic` requires `ANTHROPIC_API_KEY` (see
`.env.example`) and is otherwise identical:

```
npm run --silent agent -- --workspace echo --input "Hello" --provider anthropic
```

A manual, network-using smoke test for the real Anthropic adapter is
available separately and is never run as part of `npm test`. It has not been
run as part of this implementation:

```
npm run --silent smoke:anthropic -- --workspace echo --input "Hello"
```

## Documentation

- [Vision](docs/Vision.md) — what Agent OS is and why it exists
- [Architecture](docs/Architecture.md) — architectural decisions, boundaries,
  and invariants
- [Roadmap](docs/Roadmap.md) — milestone plan
- [Project Rules](docs/PROJECT_RULES.md) — binding rules for all work in this
  repository
