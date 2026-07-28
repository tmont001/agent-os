import type { Request, Response } from "express";
import type { WorkspacePublicMetadata } from "../workspaces/workspaceCatalog.js";

export interface WorkspacesRouteDependencies {
  readonly listWorkspaceCatalog: () => readonly WorkspacePublicMetadata[];
}

export function createWorkspacesRouteHandler(deps: WorkspacesRouteDependencies) {
  return (_req: Request, res: Response): void => {
    res.status(200).json({ workspaces: deps.listWorkspaceCatalog() });
  };
}
