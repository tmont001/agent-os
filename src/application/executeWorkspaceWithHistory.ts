import { executeWorkspace, type ExecuteWorkspaceInput } from "./executeWorkspace.js";
import type { AgentOsError } from "../errors/AgentOsError.js";
import type { AIProvider } from "../providers/AIProvider.js";
import type { WorkspaceDefinition } from "../workspaces/WorkspaceDefinition.js";
import type { RunStore } from "../runs/RunStore.js";

export type ExecuteWorkspaceWithHistoryOutput =
  | { readonly ok: true; readonly output: string; readonly runId: string | null; readonly persisted: boolean }
  | { readonly ok: false; readonly error: AgentOsError };

export interface ExecuteWorkspaceWithHistoryDependencies {
  readonly resolveWorkspace: (id: string) => WorkspaceDefinition | undefined;
  readonly aiProvider: AIProvider;
  readonly runStore: RunStore;
}

/**
 * Wraps (never modifies) executeWorkspace with persistence. Provider/
 * application failure creates no run record. A successful generation is
 * always returned even if saving it fails — persistence is a secondary
 * signal, never a reason to lose or misrepresent a successful result as a
 * provider error (M5_DESIGN.md Section 5).
 */
export async function executeWorkspaceWithHistory(
  input: ExecuteWorkspaceInput,
  deps: ExecuteWorkspaceWithHistoryDependencies
): Promise<ExecuteWorkspaceWithHistoryOutput> {
  const result = await executeWorkspace(input, {
    resolveWorkspace: deps.resolveWorkspace,
    aiProvider: deps.aiProvider,
  });

  if (!result.ok) {
    return result;
  }

  try {
    const saved = await deps.runStore.save({
      workspaceId: input.workspaceId,
      input: input.userInput,
      output: result.output,
    });

    return { ok: true, output: result.output, runId: saved.id, persisted: true };
  } catch {
    return { ok: true, output: result.output, runId: null, persisted: false };
  }
}
