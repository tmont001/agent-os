# M3 Architecture Review — Job Application Review Web Interface

Status: post-implementation review, conducted on branch `m3-job-review-web`
after commits `5a2d878` (design) and `cfaf88e` (feature). Evidence-based:
every claim below is tied to a file read, command re-run in this session, or
explicitly marked user-confirmed.

## Verdict

**VALIDATED.**

## Evidence

- **React page consumes `POST /v1/runs`:** `apps/web/src/api/runWorkspace.ts`
  is the sole `fetch` call site, posting to `/v1/runs` with
  `Content-Type: application/json`; `App.tsx` never touches `fetch` or
  constructs the request body itself, only calling `runWorkspace(...)`.
- **`workspaceId` is `job-application-review`:** hardcoded as
  `WORKSPACE_ID` in `App.tsx` and sent unchanged in the request body — a
  frontend test (`App.test.tsx`, "sends the exact workspaceId and input")
  asserts the literal posted JSON.
- **Success and safe errors are handled:** `runWorkspace` narrows the
  response into `{ ok: true, output }` or `{ ok: false, message }`,
  reading `body.error.message` for structured `4xx`/`5xx` API errors and
  falling back to a fixed generic string
  (`"Something went wrong. Please try again."`) for network failures and
  malformed JSON — never exposing the raw `Error` or response body.
- **Output rendered as text, never HTML:** `App.tsx` renders `output`
  inside a `<pre>` via ordinary JSX text interpolation; no
  `dangerouslySetInnerHTML` or Markdown renderer exists anywhere in
  `apps/web`. A dedicated test injects an `<img onerror=...>` payload as
  model output and asserts no `<img>` element is created in the DOM.
- **Vite proxy avoids backend CORS changes:** `apps/web/vite.config.ts`
  forwards `/v1` to `http://127.0.0.1:3000` for `npm run dev:web` only;
  `src/http/createApp.ts` has no CORS middleware.
- **Backend production source unchanged:**
  `git diff --name-only 26b8f70..HEAD -- src` returns no output.
- **85 backend and 11 frontend tests pass:** confirmed by re-running
  `npm run test:all` this session (`8 backend files / 85 tests`, `1
  frontend file / 11 tests`, 0 failures).
- **Production build passes:** `npm run build:web` completes
  (`tsc -b && vite build`), emitting `dist/index.html`, one JS bundle
  (~193 kB, ~61 kB gzip), one CSS bundle (~3.7 kB, ~1.3 kB gzip).
- **CI is user-confirmed green** for commit `cfaf88e` — not independently
  re-derived by this review; `.github/workflows/ci.yml` runs
  `typecheck:all`, `test:all`, and `build:web` on push/PR.
- **Fake provider validates integration, not real critique quality:**
  `README.md`'s "Run the web interface locally" section and
  `M3_DESIGN.md` both state `AI_PROVIDER=fake` proves the visual/API path
  only; no live Anthropic call is made anywhere in M3 code, tests, or
  documented validation.

Also confirmed this session: `npm run typecheck:all` exits 0, `npm audit`
reports 0 vulnerabilities, `git diff --check` reports no whitespace errors.

## Visual QA

User-confirmed manual review (two prior visual-polish passes in this
session) approved: the two-column desktop layout (input left, review right,
≥900px), the stacked mobile layout, loading state, rendered result state,
disabled-button state, and the persistent empty-state message — all judged
portfolio-quality and accepted without further requested changes.

## Scope

Confirmed absent from `apps/web` (by reading `package.json`, `App.tsx`, and
the full `src/` tree): no router (`react-router` not a dependency, single
`App.tsx` composes the whole page), no state-management library, no UI/
component-library or CSS framework, no `shared/` DTO package (request/
response types are local to `api/runWorkspace.ts`), no deployment/hosting
configuration, no authentication, no persistence, and no live Anthropic
request (`AI_PROVIDER=fake` is the only path exercised).

## M4 recommendation

**M4 — a deliberate, manually-triggered live-Anthropic smoke test through
the web client.** M3 explicitly proved the plumbing (HTTP contract, error
handling, safe text rendering) using `FakeAIProvider`; it has not proven
that a real `job-application-review` critique is useful or well-formed end
to end. M4 should stay small: run the existing web UI once against
`AI_PROVIDER=anthropic` with a real key, outside the automated suite, and
record the result — no new code path, UI feature, or backend change is
implied.

## Closeout

**M3 READY TO CLOSE.** The branch should be merged after this review is
approved — the working tree is clean, both milestone commits are in place,
typecheck/tests/build/audit all pass reproducibly locally, and CI is
confirmed green. No open follow-up items block closure; the M4
recommendation above is a suggested next step, not a blocking gap.
