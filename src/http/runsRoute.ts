import type { NextFunction, Request, Response } from "express";
import { executeWorkspace } from "../application/executeWorkspace.js";
import type { AIProvider } from "../providers/AIProvider.js";
import type { WorkspaceDefinition } from "../workspaces/WorkspaceDefinition.js";
import { mapAgentOsErrorToResponse, mapHttpErrorToResponse } from "./mapErrorToResponse.js";
import { RunRequestSchema } from "./runRequestSchema.js";

export interface RunsRouteDependencies {
  readonly resolveWorkspace: (id: string) => WorkspaceDefinition | undefined;
  readonly aiProvider: AIProvider;
}

export function createRunsRouteHandler(deps: RunsRouteDependencies) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parseResult = RunRequestSchema.safeParse(req.body);

    if (!parseResult.success) {
      const { status, body } = mapHttpErrorToResponse("VALIDATION_ERROR");
      res.status(status).json(body);
      return;
    }

    const { workspaceId, input } = parseResult.data;

    try {
      const output = await executeWorkspace(
        { workspaceId, userInput: input },
        { resolveWorkspace: deps.resolveWorkspace, aiProvider: deps.aiProvider }
      );

      if (!output.ok) {
        const { status, body } = mapAgentOsErrorToResponse(output.error);
        res.status(status).json(body);
        return;
      }

      res.status(200).json({ output: output.output });
    } catch (error) {
      next(error);
    }
  };
}
