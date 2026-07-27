/**
 * The only module in apps/web that calls fetch. Mirrors the POST /v1/runs
 * contract exactly as implemented in src/http/runRequestSchema.ts,
 * src/http/runsRoute.ts, and src/http/mapErrorToResponse.ts — see
 * docs/milestones/M3_DESIGN.md Section 2. These types are local to the web
 * app on purpose (no shared DTO package in M3).
 */

export interface RunRequest {
  readonly workspaceId: string;
  readonly input: string;
}

export interface RunSuccess {
  readonly output: string;
}

export interface RunErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

export type RunResult =
  | { readonly ok: true; readonly output: string }
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

  if (
    typeof body !== "object" ||
    body === null ||
    !("output" in body) ||
    typeof (body as { output: unknown }).output !== "string"
  ) {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  return { ok: true, output: (body as RunSuccess).output };
}
