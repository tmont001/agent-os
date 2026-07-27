import type { WorkspaceDefinition } from "./WorkspaceDefinition.js";
import { echoWorkspace } from "./echoWorkspace.js";

const workspaces: Readonly<Record<string, WorkspaceDefinition>> = {
  [echoWorkspace.id]: echoWorkspace,
};

export function resolveWorkspace(id: string): WorkspaceDefinition | undefined {
  return workspaces[id];
}
