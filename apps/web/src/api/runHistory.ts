/**
 * The only module that calls fetch for the run-history endpoints
 * (GET /v1/runs, GET /v1/runs/:id, DELETE /v1/runs/:id) — mirrors
 * src/http/runHistoryRoute.ts. Types are local to the web app on purpose
 * (no shared DTO package); this module never imports backend source.
 */

export interface RunSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly inputPreview: string;
}

export interface RunRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly input: string;
  readonly output: string;
}

export type RunHistoryResult =
  | { readonly ok: true; readonly runs: readonly RunSummary[] }
  | { readonly ok: false; readonly message: string };

export type RunDetailResult =
  | { readonly status: "found"; readonly record: RunRecord }
  | { readonly status: "missing" }
  | { readonly status: "error"; readonly message: string };

export type DeleteRunResult =
  | { readonly status: "deleted" }
  | { readonly status: "missing" }
  | { readonly status: "error"; readonly message: string };

const GENERIC_HISTORY_ERROR_MESSAGE = "Unable to load run history. Please try again.";
const GENERIC_DELETE_ERROR_MESSAGE = "Unable to delete this run. Please try again.";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRunSummary(value: unknown): value is RunSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.workspaceId) &&
    isNonEmptyString(candidate.createdAt) &&
    isNonEmptyString(candidate.inputPreview)
  );
}

function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.workspaceId) &&
    isNonEmptyString(candidate.createdAt) &&
    isNonEmptyString(candidate.input) &&
    isNonEmptyString(candidate.output)
  );
}

/** Rejects a missing/non-array `runs`, any invalid entry, or duplicate ids. */
function parseRunSummaries(body: unknown): readonly RunSummary[] | undefined {
  if (typeof body !== "object" || body === null || !("runs" in body)) {
    return undefined;
  }

  const runs = (body as { runs: unknown }).runs;
  if (!Array.isArray(runs) || !runs.every(isRunSummary)) {
    return undefined;
  }

  const seenIds = new Set<string>();
  for (const entry of runs) {
    if (seenIds.has(entry.id)) {
      return undefined;
    }
    seenIds.add(entry.id);
  }

  return runs;
}

export async function fetchRunHistory(): Promise<RunHistoryResult> {
  let response: Response;
  try {
    response = await fetch("/v1/runs");
  } catch {
    return { ok: false, message: GENERIC_HISTORY_ERROR_MESSAGE };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: GENERIC_HISTORY_ERROR_MESSAGE };
  }

  if (!response.ok) {
    return { ok: false, message: GENERIC_HISTORY_ERROR_MESSAGE };
  }

  const runs = parseRunSummaries(body);
  if (runs === undefined) {
    return { ok: false, message: GENERIC_HISTORY_ERROR_MESSAGE };
  }

  return { ok: true, runs };
}

export async function fetchRunById(id: string): Promise<RunDetailResult> {
  let response: Response;
  try {
    response = await fetch(`/v1/runs/${encodeURIComponent(id)}`);
  } catch {
    return { status: "error", message: GENERIC_HISTORY_ERROR_MESSAGE };
  }

  if (response.status === 404) {
    return { status: "missing" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "error", message: GENERIC_HISTORY_ERROR_MESSAGE };
  }

  if (!response.ok || !isRunRecord(body)) {
    return { status: "error", message: GENERIC_HISTORY_ERROR_MESSAGE };
  }

  return { status: "found", record: body };
}

/**
 * A 204 is the success path and carries no body — it must never attempt to
 * parse one. A 404 (missing or already-deleted) is a distinct, safe
 * "missing" outcome, not an error.
 */
export async function deleteRunById(id: string): Promise<DeleteRunResult> {
  let response: Response;
  try {
    response = await fetch(`/v1/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    return { status: "error", message: GENERIC_DELETE_ERROR_MESSAGE };
  }

  if (response.status === 204) {
    return { status: "deleted" };
  }

  if (response.status === 404) {
    return { status: "missing" };
  }

  return { status: "error", message: GENERIC_DELETE_ERROR_MESSAGE };
}
