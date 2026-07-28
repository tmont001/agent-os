import type { AgentOsError, AgentOsErrorCode } from "../errors/AgentOsError.js";

/**
 * Transport-local failures that occur purely at the HTTP boundary, before a
 * request could even reach executeWorkspace. Separate from AgentOsErrorCode
 * (ADR 0002) — M1 adds no new AgentOsErrorCode values.
 */
export type HttpErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "ROUTE_NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "RUN_NOT_FOUND"
  | "UNEXPECTED";

/**
 * PROVIDER_MISCONFIGURED is a startup/composition-only failure
 * (M1_DESIGN.md Section 5) and must never be part of the public HTTP
 * contract. Excluding it here makes that unrepresentable at the type level,
 * not just documented — the public response code can never be
 * "PROVIDER_MISCONFIGURED".
 */
export type PublicResponseCode = HttpErrorCode | Exclude<AgentOsErrorCode, "PROVIDER_MISCONFIGURED">;

export interface HttpErrorBody {
  readonly error: {
    readonly code: PublicResponseCode;
    readonly message: string;
    readonly retryable: boolean;
  };
}

export interface MappedResponse {
  readonly status: number;
  readonly body: HttpErrorBody;
}

const HTTP_ERROR_MESSAGES: Readonly<Record<HttpErrorCode, string>> = {
  INVALID_JSON: "Request body must contain valid JSON.",
  VALIDATION_ERROR: "Request body must contain only workspaceId and input as strings.",
  UNSUPPORTED_MEDIA_TYPE: "Content-Type must be application/json.",
  PAYLOAD_TOO_LARGE: "Request body is too large.",
  ROUTE_NOT_FOUND: "Route not found.",
  METHOD_NOT_ALLOWED: "Method not allowed.",
  RUN_NOT_FOUND: "Run not found.",
  UNEXPECTED: "An unexpected error occurred.",
};

const HTTP_ERROR_STATUS: Readonly<Record<HttpErrorCode, number>> = {
  INVALID_JSON: 400,
  VALIDATION_ERROR: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  ROUTE_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  RUN_NOT_FOUND: 404,
  UNEXPECTED: 500,
};

type PublicAgentOsErrorCode = Exclude<AgentOsErrorCode, "PROVIDER_MISCONFIGURED">;

const AGENT_OS_ERROR_STATUS: Readonly<Record<PublicAgentOsErrorCode, number>> = {
  INVALID_INPUT: 400,
  WORKSPACE_NOT_FOUND: 404,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_ERROR: 502,
};

function isPublicAgentOsErrorCode(code: AgentOsErrorCode): code is PublicAgentOsErrorCode {
  return code !== "PROVIDER_MISCONFIGURED";
}

export function mapHttpErrorToResponse(code: HttpErrorCode): MappedResponse {
  return {
    status: HTTP_ERROR_STATUS[code],
    body: {
      error: {
        code,
        message: HTTP_ERROR_MESSAGES[code],
        retryable: false,
      },
    },
  };
}

/**
 * Maps an AgentOsError to its public HTTP response. PROVIDER_MISCONFIGURED
 * is a startup-only failure and is never expected to reach this function
 * from a request-handling path (the server fails before .listen() instead —
 * M1_DESIGN.md Section 5). If it somehow did anyway, this fails closed:
 * the response is rendered as UNEXPECTED, never exposing
 * "PROVIDER_MISCONFIGURED" or its original message.
 */
export function mapAgentOsErrorToResponse(error: AgentOsError): MappedResponse {
  if (!isPublicAgentOsErrorCode(error.code)) {
    return mapHttpErrorToResponse("UNEXPECTED");
  }

  return {
    status: AGENT_OS_ERROR_STATUS[error.code],
    body: {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    },
  };
}
