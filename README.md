# agent-os

Agent OS is a modular AI Agent Operating System: a substrate for defining,
running, and observing agents that can plan, call tools, and execute
multi-step work, independent of any single frontend or AI provider. It's built
with TypeScript, React, Express, and Claude.

## Status

M0 (the Echo walking skeleton, CLI-only) is complete and merged; see
[docs/reviews/M0_ARCHITECTURE_REVIEW.md](docs/reviews/M0_ARCHITECTURE_REVIEW.md).
M1 (an HTTP input adapter over the same application boundary — see
[docs/milestones/M1_DESIGN.md](docs/milestones/M1_DESIGN.md)) has been
implemented on the `m1-http-adapter` branch and passes local type-checking
and the automated test suite, all without a live Anthropic API key or
network access. It has not yet been reviewed or merged.

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

## Running the HTTP server

The HTTP server exposes the same `executeWorkspace` use case as the CLI,
over `POST /v1/runs`. Unlike the CLI, the server's `AI_PROVIDER` is
**required — there is no default** — so a forgotten configuration fails
loudly at startup instead of silently serving fake responses:

```
AI_PROVIDER=fake npm run start
```

This binds to `127.0.0.1:3000` (override the port with `PORT`). To
explicitly select the real Anthropic provider instead, set both:

```
AI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-... npm run start
```

**Provider selection is a server-owned configuration decision — it cannot be
supplied in HTTP request data.** A request containing a `provider`, `model`,
or any field beyond `workspaceId`/`input` is rejected with a `400
VALIDATION_ERROR`. The live Anthropic path remains optional here too, and
has not been validated as part of this implementation unless a real smoke
test is deliberately run later with a valid key.

Request/response example:

```
POST /v1/runs
Content-Type: application/json

{ "workspaceId": "echo", "input": "Hello" }
```

```json
{ "output": "Echo: Hello" }
```

```
curl -i -X POST -H "Content-Type: application/json" \
  -d '{"workspaceId":"echo","input":"Hello"}' \
  http://127.0.0.1:3000/v1/runs
```

## Run the web interface locally

M3 adds a minimal React client (`apps/web`) that submits one job-application
response to the `job-application-review` workspace through the existing
`POST /v1/runs` endpoint. It talks to the API through a local Vite dev
proxy, so no CORS change or backend code change was needed. Use two
terminals:

```
# Terminal 1
AI_PROVIDER=fake npm run dev

# Terminal 2
npm run dev:web
```

Open the URL Vite prints (typically `http://localhost:5173`). The
`AI_PROVIDER=fake` provider validates the visual/API path only — it does not
generate a genuine job-application critique. A real Anthropic smoke test is
a separate, deliberate step and is not part of M3 validation.

## Documentation

- [Vision](docs/Vision.md) — what Agent OS is and why it exists
- [Architecture](docs/Architecture.md) — architectural decisions, boundaries,
  and invariants
- [Roadmap](docs/Roadmap.md) — milestone plan
- [Project Rules](docs/PROJECT_RULES.md) — binding rules for all work in this
  repository
