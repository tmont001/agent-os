import type { WorkspaceDefinition } from "./WorkspaceDefinition.js";
import { echoWorkspace } from "./echoWorkspace.js";
import { jobApplicationReviewWorkspace } from "./jobApplicationReviewWorkspace.js";
import { researchBriefWorkspace } from "./researchBriefWorkspace.js";

const workspaces: Readonly<Record<string, WorkspaceDefinition>> = {
  [echoWorkspace.id]: echoWorkspace,
  [jobApplicationReviewWorkspace.id]: jobApplicationReviewWorkspace,
  [researchBriefWorkspace.id]: researchBriefWorkspace,
};

export function resolveWorkspace(id: string): WorkspaceDefinition | undefined {
  return workspaces[id];
}
