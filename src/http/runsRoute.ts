import type { NextFunction, Request, Response } from "express";
import { executeWorkspaceWithHistory } from "../application/executeWorkspaceWithHistory.js";
import type { AIProvider } from "../providers/AIProvider.js";
import type { WorkspaceDefinition } from "../workspaces/WorkspaceDefinition.js";
import type { RunStore } from "../runs/RunStore.js";
import { mapAgentOsErrorToResponse, mapHttpErrorToResponse } from "./mapErrorToResponse.js";
import { RunRequestSchema } from "./runRequestSchema.js";

export interface RunsRouteDependencies {
  readonly resolveWorkspace: (id: string) => WorkspaceDefinition | undefined;
  readonly aiProvider: AIProvider;
  readonly runStore: RunStore;
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
      const result = await executeWorkspaceWithHistory(
        { workspaceId, userInput: input },
        {
          resolveWorkspace: deps.resolveWorkspace,
          aiProvider: deps.aiProvider,
          runStore: deps.runStore,
        }
      );

      if (!result.ok) {
        const { status, body } = mapAgentOsErrorToResponse(result.error);
        res.status(status).json(body);
        return;
      }

      res
        .status(200)
        .json({ output: result.output, runId: result.runId, persisted: result.persisted });
    } catch (error) {
      next(error);
    }
  };
}
