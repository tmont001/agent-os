import { jobApplicationReviewWorkspace } from "./jobApplicationReviewWorkspace.js";
import { researchBriefWorkspace } from "./researchBriefWorkspace.js";

/**
 * The public, display-time counterpart to WorkspaceDefinition. Deliberately
 * a separate type — instructions are execution-time-only and must never
 * reach a transport boundary (see docs/milestones/M4_DESIGN.md Section 4).
 */
export interface WorkspacePublicMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
}

/**
 * An explicit, literal mapping — not a filter over resolveWorkspace's map.
 * Echo is intentionally never listed here: it stays resolvable via
 * resolveWorkspace("echo") for internal/CLI use but is structurally absent
 * from anything this catalog returns.
 */
const catalog: readonly WorkspacePublicMetadata[] = [
  {
    id: jobApplicationReviewWorkspace.id,
    displayName: "Job Application Review",
    description:
      "Review a draft application response and get what's strong, what needs work, and a revised version.",
  },
  {
    id: researchBriefWorkspace.id,
    displayName: "Research Brief",
    description:
      "Turn pasted notes or source excerpts into a summary, key findings, and open questions.",
  },
];

export function listWorkspaceCatalog(): readonly WorkspacePublicMetadata[] {
  return catalog;
}
