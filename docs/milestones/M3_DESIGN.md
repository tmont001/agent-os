# M3 Design — Job Application Review Web Interface

Status: design only, immediately followed by implementation on this branch.
Complies with [../Vision.md](../Vision.md), [../Architecture.md](../Architecture.md),
[../PROJECT_RULES.md](../PROJECT_RULES.md), and
[../reviews/M2_ARCHITECTURE_REVIEW.md](../reviews/M2_ARCHITECTURE_REVIEW.md)
(M3 recommendation). Does not redesign or reimplement `POST /v1/runs`, the
HTTP request schema, error mapping, `executeWorkspace`, workspace resolution,
`jobApplicationReviewWorkspace`, provider selection, or server startup — all
validated by M0–M2 and reused unchanged.

## 1. Purpose

M3 proves the first visual Agent OS client: a single React page that submits
one job-application response to the existing
`job-application-review` workspace through the existing, unmodified
`POST /v1/runs` endpoint. It proves the frontend/backend boundary
(`docs/Architecture.md` "Frontend / backend contract") is real by consuming
the backend only through its public transport API — never backend internals.

## 2. Confirmed contract (read from source, not assumed)

From `src/http/runRequestSchema.ts`, `src/http/runsRoute.ts`, and
`src/http/mapErrorToResponse.ts`:

- **Request:** `POST /v1/runs`, `Content-Type: application/json`, body is
  `{ workspaceId: string; input: string }` exactly — `.strict()`, no
  additional fields (a `provider` or `model` field is rejected with
  `VALIDATION_ERROR`).
- **Success response:** `200` with body `{ output: string }`.
- **Error response:** body `{ error: { code: string; message: string;
  retryable: boolean } }`. Status varies by code (400 `VALIDATION_ERROR` /
  `INVALID_INPUT`, 404 `WORKSPACE_NOT_FOUND` / `ROUTE_NOT_FOUND`, 405
  `METHOD_NOT_ALLOWED`, 413 `PAYLOAD_TOO_LARGE`, 415
  `UNSUPPORTED_MEDIA_TYPE`, 502 `PROVIDER_ERROR`, 503
  `PROVIDER_UNAVAILABLE`, 500 `UNEXPECTED`). The `error.message` field is
  always the safe, public-facing string — never a stack trace, provider
  body, or internal cause.
- The server (`src/http/server.ts`) binds to `127.0.0.1:3000` by default and
  requires `AI_PROVIDER` to be set explicitly (no default) — `fake` for
  local/dev/test use, `anthropic` for a real key.

The web client's request/response types are written to mirror this shape
exactly, as observed in the code above.

## 3. Decisions

- **Location:** `apps/web`, a native npm workspace member declared in the
  existing root `package.json` (`"workspaces": ["apps/web"]`). No
  Turborepo/Nx.
- **Stack:** React + TypeScript + Vite. Vite is dev-server/build tooling
  only, not a runtime dependency of the backend.
- **One page, no router.** A single `App.tsx` renders the whole experience;
  `react-router` is not installed.
- **Transport:** the browser calls the real `POST /v1/runs` HTTP contract
  above — no mocked backend, no generated client, no schema-validation
  library in the browser (the backend already validates; duplicating that
  client-side would be redundant surface, not a real boundary per
  `PROJECT_RULES.md` #7).
- **Request body sent:** `{ "workspaceId": "job-application-review",
  "input": "<user text>" }`.
- **Browser request path:** `/v1/runs`, relative — no origin hardcoded in
  the client, so the same code works against the Vite dev proxy and any
  future same-origin production deployment.
- **Vite dev proxy:** `vite.config.ts` forwards `/v1/*` to
  `http://127.0.0.1:3000` during `npm run dev:web`. This is a **local
  development convenience only** — it lets the Vite dev server (a different
  origin/port than the API) serve the page while same-origin `fetch("/v1/runs")`
  calls reach the real backend, without the backend needing to add CORS
  headers. It has no effect on `npm run build:web`'s static output and is
  not itself a deployment or hosting mechanism. **Production hosting of
  `apps/web`'s built assets is out of scope for M3** and deferred to a later
  milestone; nothing here assumes or designs for a specific production
  origin.
- **No CORS change to the API.** Because the proxy makes requests
  same-origin from the browser's perspective, `src/http/createApp.ts` needs
  no CORS middleware, preserving the "no backend production-code changes"
  constraint below.
- **No backend production-code changes.** Everything under `src/` (other
  than tests, if a genuine gap is found) is untouched.
- **No shared DTO package in M3.** `apps/web/src/api/runWorkspace.ts` defines
  its own local `RunRequest`/`RunResponse`/error types that mirror Section 2
  above by hand. Per `Architecture.md` "`shared/` scope" and
  `PROJECT_RULES.md` #15, a `shared/` package is created only for an
  intentional cross-process contract once duplication becomes a demonstrated
  problem — one milestone with one small, stable contract does not meet that
  bar yet.
- **Raw output display:** the workspace's `output` string is rendered as
  plain text (React's default text-node rendering, e.g. inside a `<pre>` or
  a whitespace-preserving container) — never via `dangerouslySetInnerHTML`,
  never through a Markdown renderer. Newlines/whitespace are preserved with
  CSS (`white-space: pre-wrap`), not by interpreting the string as markup.
- **Testing:** Vitest + jsdom + React Testing Library, with `fetch` mocked
  at the module boundary (`api/runWorkspace.ts`) — no real network socket,
  no real Express server, no Anthropic key, matching the network-free
  testing invariant already enforced for the backend.
- **Deployment:** explicitly excluded from M3, as it was from M0–M2's
  backend-first scope. `npm run build:web` proves the production bundle
  compiles; nothing serves or hosts it yet.

## 4. Frontend structure

```
apps/web/
  index.html
  vite.config.ts
  tsconfig.json
  tsconfig.node.json
  package.json
  src/
    main.tsx        — React bootstrap, mounts <App /> into #root
    App.tsx          — page state (input, loading, result, error) + composition
    App.css           — all M3 visual styles (single stylesheet)
    api/
      runWorkspace.ts — typed fetch boundary for POST /v1/runs
    test/
      setup.ts        — RTL/jsdom test setup (jest-dom matchers)
    App.test.tsx       — component tests (Section 7 of the milestone prompt)
```

`api/runWorkspace.ts` is the only module that calls `fetch`. `App.tsx` never
constructs a request body itself — it calls `runWorkspace(input)` and
renders the typed result. This keeps the HTTP contract in exactly one place,
mirroring how `runsRoute.ts` is the one place the backend touches the wire
shape.

## 5. Root workspace wiring

- Root `package.json` gains `"workspaces": ["apps/web"]` and these scripts:
  - `dev` (existing, unchanged) — starts the API.
  - `dev:web` — `npm run dev --workspace apps/web` (Vite dev server).
  - `typecheck:web` — `npm run typecheck --workspace apps/web`.
  - `test:web` — `npm run test --workspace apps/web` (Vitest, run mode).
  - `build:web` — `npm run build --workspace apps/web`.
  - `typecheck:all` — runs the root `tsc --noEmit` and `typecheck:web`.
  - `test:all` — runs the root `vitest run` and `test:web`.
- No `concurrently`/`npm-run-all` dependency is added. Local development uses
  two terminals, documented in the README (Section 6 of the milestone
  prompt).

## 6. Out of scope (explicit)

React Router, a state-management library, a component library, a CSS
framework, an API-generation library, a browser-side schema-validation
dependency, a Markdown renderer, a design-system package, a `shared/`
package, generic service/repository layering, an environment-variable
framework, multiple pages, deployment/hosting, and any live Anthropic
request.
