export type AgentOsErrorCode =
  | "INVALID_INPUT"
  | "WORKSPACE_NOT_FOUND"
  | "PROVIDER_MISCONFIGURED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR";

export interface AgentOsError {
  readonly code: AgentOsErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}
