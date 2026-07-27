import { parseArgs } from "node:util";
import { executeWorkspace } from "../application/executeWorkspace.js";
import { resolveWorkspace } from "../workspaces/resolveWorkspace.js";
import { FakeAIProvider } from "../providers/FakeAIProvider.js";
import type { AIProvider } from "../providers/AIProvider.js";
import type { AgentOsError } from "../errors/AgentOsError.js";

function usageError(message: string): void {
  process.stderr.write(`Usage error: ${message}\n`);
  process.exitCode = 2;
}

function agentError(error: AgentOsError): void {
  process.stderr.write(`Error [${error.code}]: ${error.message}\n`);
  process.exitCode = 1;
}

function unexpectedError(): void {
  process.stderr.write("Error [UNEXPECTED]: an unexpected error occurred\n");
  process.exitCode = 1;
}

async function main(): Promise<void> {
  let values: {
    workspace?: string;
    input?: string;
    provider?: string;
    "simulate-failure"?: boolean;
  };

  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        workspace: { type: "string" },
        input: { type: "string" },
        provider: { type: "string" },
        "simulate-failure": { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    return usageError(error instanceof Error ? error.message : "invalid arguments");
  }

  const workspaceId = values.workspace;
  if (workspaceId === undefined) {
    return usageError("--workspace is required");
  }

  const userInput = values.input;
  if (userInput === undefined) {
    return usageError("--input is required");
  }

  const providerName = values.provider ?? "fake";
  if (providerName !== "fake" && providerName !== "anthropic") {
    return usageError(`unsupported --provider value "${providerName}" (expected "fake" or "anthropic")`);
  }

  const simulateFailure = values["simulate-failure"] ?? false;
  if (simulateFailure && providerName === "anthropic") {
    return usageError("--simulate-failure may only be used with --provider fake");
  }

  let aiProvider: AIProvider;

  if (providerName === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return agentError({
        code: "PROVIDER_MISCONFIGURED",
        message: "ANTHROPIC_API_KEY is not set",
        retryable: false,
      });
    }

    // Dynamic import: the default (fake) path above never reaches this line,
    // so it never loads the Anthropic adapter or the @anthropic-ai/sdk module.
    const { AnthropicAIProvider } = await import("../providers/AnthropicAIProvider.js");
    aiProvider = new AnthropicAIProvider({ apiKey });
  } else {
    aiProvider = new FakeAIProvider(simulateFailure ? { behavior: "failure" } : undefined);
  }

  const output = await executeWorkspace(
    { workspaceId, userInput },
    { resolveWorkspace, aiProvider }
  );

  if (!output.ok) {
    return agentError(output.error);
  }

  process.stdout.write(`${output.output}\n`);
  process.exitCode = 0;
}

main().catch(() => {
  unexpectedError();
});
