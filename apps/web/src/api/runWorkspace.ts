/**
 * The only module in apps/web that calls fetch for POST /v1/runs. Mirrors
 * that contract exactly as implemented in src/http/runRequestSchema.ts,
 * src/http/runsRoute.ts, and src/http/mapErrorToResponse.ts — see
 * docs/milestones/M5_DESIGN.md Section 6. These types are local to the web
 * app on purpose (no shared DTO package).
 */

export interface RunRequest {
  readonly workspaceId: string;
  readonly input: string;
}

export interface RunSuccessBody {
  readonly output: string;
  readonly runId: string | null;
  readonly persisted: boolean;
}

export interface RunErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

export type RunResult =
  | { readonly ok: true; readonly output: string; readonly runId: string | null; readonly persisted: boolean }
  | { readonly ok: false; readonly message: string };

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

function isRunErrorBody(value: unknown): value is RunErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const error = (value as { error: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  );
}

/**
 * Validates every field and their cross-field consistency: persisted:true
 * requires a non-empty-string runId; persisted:false requires runId to be
 * exactly null. Any other combination (missing field, wrong type, a
 * runId/persisted mismatch) is malformed.
 */
function isRunSuccessBody(value: unknown): value is RunSuccessBody {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.output !== "string" || typeof candidate.persisted !== "boolean") {
    return false;
  }

  if (candidate.persisted) {
    return typeof candidate.runId === "string" && candidate.runId.length > 0;
  }

  return candidate.runId === null;
}

export async function runWorkspace(request: RunRequest): Promise<RunResult> {
  let response: Response;
  try {
    response = await fetch("/v1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  if (!response.ok) {
    if (isRunErrorBody(body)) {
      return { ok: false, message: body.error.message };
    }
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  if (!isRunSuccessBody(body)) {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  return { ok: true, output: body.output, runId: body.runId, persisted: body.persisted };
}
