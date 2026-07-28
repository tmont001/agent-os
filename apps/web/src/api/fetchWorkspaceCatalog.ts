/**
 * The second and only other fetch call site in apps/web (see
 * api/runWorkspace.ts). Validates the parsed JSON at runtime rather than
 * trusting TypeScript types at the network boundary — see
 * docs/milestones/M4_DESIGN.md Section 6. No Zod or other new dependency:
 * a small local type guard/parser is enough for this shape.
 */

export interface WorkspaceMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
}

export type CatalogResult =
  | { readonly ok: true; readonly workspaces: readonly WorkspaceMetadata[] }
  | { readonly ok: false; readonly message: string };

const GENERIC_CATALOG_ERROR_MESSAGE = "Unable to load workspaces. Please try again.";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isWorkspaceMetadata(value: unknown): value is WorkspaceMetadata {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.displayName) &&
    isNonEmptyString(candidate.description)
  );
}

/**
 * Returns the validated entries, or undefined for any malformed shape
 * (missing/non-array workspaces, an invalid entry, or duplicate ids).
 */
function parseWorkspaceCatalog(body: unknown): readonly WorkspaceMetadata[] | undefined {
  if (typeof body !== "object" || body === null || !("workspaces" in body)) {
    return undefined;
  }

  const workspaces = (body as { workspaces: unknown }).workspaces;
  if (!Array.isArray(workspaces) || !workspaces.every(isWorkspaceMetadata)) {
    return undefined;
  }

  const seenIds = new Set<string>();
  for (const entry of workspaces) {
    if (seenIds.has(entry.id)) {
      return undefined;
    }
    seenIds.add(entry.id);
  }

  return workspaces;
}

export async function fetchWorkspaceCatalog(): Promise<CatalogResult> {
  let response: Response;
  try {
    response = await fetch("/v1/workspaces");
  } catch {
    return { ok: false, message: GENERIC_CATALOG_ERROR_MESSAGE };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: GENERIC_CATALOG_ERROR_MESSAGE };
  }

  if (!response.ok) {
    return { ok: false, message: GENERIC_CATALOG_ERROR_MESSAGE };
  }

  const workspaces = parseWorkspaceCatalog(body);
  if (workspaces === undefined) {
    return { ok: false, message: GENERIC_CATALOG_ERROR_MESSAGE };
  }

  return { ok: true, workspaces };
}
