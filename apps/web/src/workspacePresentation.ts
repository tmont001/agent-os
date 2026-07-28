/**
 * Client-local interaction copy — textarea placeholder and submit-button
 * wording. This is UI copy with no backend meaning, so it stays here rather
 * than growing the /v1/workspaces metadata contract into a UI-schema system
 * (see docs/milestones/M4_DESIGN.md Section 6). Title/description come from
 * the server's public catalog metadata instead.
 */

export interface WorkspacePresentation {
  readonly placeholder: string;
  readonly submitLabel: string;
  readonly submitLabelLoading: string;
  readonly trustNote: string;
}

const DEFAULT_PRESENTATION: WorkspacePresentation = {
  placeholder: "Paste your material here…",
  submitLabel: "Run workspace",
  submitLabelLoading: "Running…",
  trustNote: "Uses only the material you provide.",
};

const PRESENTATION_BY_WORKSPACE_ID: Readonly<Record<string, WorkspacePresentation>> = {
  "job-application-review": {
    placeholder: "Paste the application question (optional) and your draft answer here…",
    submitLabel: "Review response",
    submitLabelLoading: "Reviewing…",
    trustNote: "Uses only the information you provide. It will not invent experience or results.",
  },
  "research-brief": {
    placeholder: "Paste your notes or source excerpts here…",
    submitLabel: "Generate brief",
    submitLabelLoading: "Generating…",
    trustNote: "Uses only the material you provide. It will not add outside sources or unsupported claims.",
  },
};

export function getWorkspacePresentation(workspaceId: string): WorkspacePresentation {
  return PRESENTATION_BY_WORKSPACE_ID[workspaceId] ?? DEFAULT_PRESENTATION;
}
