import type { AgentOsError } from "../errors/AgentOsError.js";

export interface AIProviderRequest {
  readonly instructions: string;
  readonly input: string;
}

export interface AIProviderSuccess {
  readonly ok: true;
  readonly output: string;
}

/**
 * Provider adapters may only ever produce these two codes — never
 * INVALID_INPUT, WORKSPACE_NOT_FOUND, or PROVIDER_MISCONFIGURED, which are
 * exclusively application/composition-root-owned (see AgentOsError).
 */
export type ProviderErrorCode = "PROVIDER_UNAVAILABLE" | "PROVIDER_ERROR";

export interface ProviderError extends AgentOsError {
  readonly code: ProviderErrorCode;
}

export interface AIProviderFailure {
  readonly ok: false;
  readonly error: ProviderError;
}

export type AIProviderResult = AIProviderSuccess | AIProviderFailure;

export interface AIProvider {
  generate(request: AIProviderRequest): Promise<AIProviderResult>;
}
