import type { AgentOsError } from "../errors/AgentOsError.js";
import type { AIProvider } from "../providers/AIProvider.js";
import type { WorkspaceDefinition } from "../workspaces/WorkspaceDefinition.js";

export interface ExecuteWorkspaceInput {
  readonly workspaceId: string;
  readonly userInput: string;
}

export type ExecuteWorkspaceOutput =
  | { readonly ok: true; readonly output: string }
  | { readonly ok: false; readonly error: AgentOsError };

export interface ExecuteWorkspaceDependencies {
  readonly resolveWorkspace: (id: string) => WorkspaceDefinition | undefined;
  readonly aiProvider: AIProvider;
}

export async function executeWorkspace(
  input: ExecuteWorkspaceInput,
  deps: ExecuteWorkspaceDependencies
): Promise<ExecuteWorkspaceOutput> {
  const trimmedInput = input.userInput.trim();
  if (trimmedInput.length === 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Input must not be empty.",
        retryable: false,
      },
    };
  }

  const workspace = deps.resolveWorkspace(input.workspaceId);
  if (workspace === undefined) {
    return {
      ok: false,
      error: {
        code: "WORKSPACE_NOT_FOUND",
        message: `No workspace found for id "${input.workspaceId}".`,
        retryable: false,
      },
    };
  }

  const result = await deps.aiProvider.generate({
    instructions: workspace.instructions,
    input: trimmedInput,
  });

  if (!result.ok) {
    return result;
  }

  return { ok: true, output: result.output };
}
