import Anthropic, {
  APIConnectionError,
  APIError,
  InternalServerError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderResult,
} from "./AIProvider.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

const MAX_TOKENS = 1024;

export interface AnthropicAIProviderOptions {
  readonly apiKey: string;
  /** Adapter-level/testing use only — never exposed by the CLI or a workspace. */
  readonly model?: string;
  /** Test-only injection point. Omitted in production, in which case the SDK's real fetch is used. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * The only production source file allowed to import @anthropic-ai/sdk.
 *
 * maxRetries is fixed at 0 so a given failure maps to exactly one
 * deterministic AgentOsError, with no hidden retry loop between the request
 * and the normalized result. timeout is fixed at 30s so this adapter (and
 * especially the manual smoke path) never appears to hang indefinitely.
 * Neither is configurable per call site.
 */
export class AnthropicAIProvider implements AIProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicAIProviderOptions) {
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      fetch: options.fetch,
      maxRetries: 0,
      timeout: 30_000,
    });
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResult> {
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: request.instructions,
        messages: [{ role: "user", content: request.input }],
      });

      const output = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      return { ok: true, output };
    } catch (error) {
      // Transient: rate limiting, server-side errors, and connection-level
      // failures (fetch rejected/aborted, including timeouts — SDK's
      // APIConnectionTimeoutError extends APIConnectionError).
      if (
        error instanceof RateLimitError ||
        error instanceof InternalServerError ||
        error instanceof APIConnectionError
      ) {
        return {
          ok: false,
          error: {
            code: "PROVIDER_UNAVAILABLE",
            message: "The AI provider is temporarily unavailable. Please try again.",
            retryable: true,
            cause: error,
          },
        };
      }

      // Permanent: any other known API error (bad request, auth, permission,
      // not found, conflict, unprocessable entity, etc.).
      if (error instanceof APIError) {
        return {
          ok: false,
          error: {
            code: "PROVIDER_ERROR",
            message: "The AI provider rejected the request.",
            retryable: false,
            cause: error,
          },
        };
      }

      // Not a recognized provider failure — let it propagate rather than
      // silently normalizing what may be a bug in this adapter.
      throw error;
    }
  }
}
