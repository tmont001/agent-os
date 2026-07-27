import type { WorkspaceDefinition } from "./WorkspaceDefinition.js";
import { echoWorkspace } from "./echoWorkspace.js";
import { jobApplicationReviewWorkspace } from "./jobApplicationReviewWorkspace.js";

const workspaces: Readonly<Record<string, WorkspaceDefinition>> = {
  [echoWorkspace.id]: echoWorkspace,
  [jobApplicationReviewWorkspace.id]: jobApplicationReviewWorkspace,
};

export function resolveWorkspace(id: string): WorkspaceDefinition | undefined {
  return workspaces[id];
}
