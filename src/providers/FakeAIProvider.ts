import type {
  AIProvider,
  AIProviderRequest,
  AIProviderResult,
} from "./AIProvider.js";

export interface FakeAIProviderOptions {
  readonly behavior?: "success" | "failure";
}

/**
 * Deterministic, offline, no-secrets adapter implementing AIProvider.
 *
 * The failure mode is selected explicitly via a constructor option, never by
 * inspecting the request's input text — a magic string would be fragile (a
 * real user could type it by accident) and would silently couple test
 * behavior to content the use case is supposed to treat as opaque.
 */
export class FakeAIProvider implements AIProvider {
  private readonly behavior: "success" | "failure";

  constructor(options?: FakeAIProviderOptions) {
    this.behavior = options?.behavior ?? "success";
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResult> {
    if (this.behavior === "failure") {
      return {
        ok: false,
        error: {
          code: "PROVIDER_ERROR",
          message: "The fake provider was configured to fail.",
          retryable: false,
        },
      };
    }

    return {
      ok: true,
      output: `Echo: ${request.input}`,
    };
  }
}
