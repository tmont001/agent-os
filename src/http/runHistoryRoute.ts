import type { NextFunction, Request, Response } from "express";
import type { RunStore } from "../runs/RunStore.js";
import { mapHttpErrorToResponse } from "./mapErrorToResponse.js";

export interface RunHistoryRouteDependencies {
  readonly runStore: RunStore;
}

/**
 * GET /v1/runs — summaries only (never full input/output), in whatever
 * order RunStore.list() already returns (newest-first, deterministic).
 */
export function createListRunsRouteHandler(deps: RunHistoryRouteDependencies) {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const runs = await deps.runStore.list();
      res.status(200).json({ runs });
    } catch (error) {
      next(error);
    }
  };
}

/** GET /v1/runs/:id — the full record, or a safe 404 if it doesn't exist. */
export function createGetRunRouteHandler(deps: RunHistoryRouteDependencies) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const record = await deps.runStore.getById(req.params.id as string);

      if (record === undefined) {
        const { status, body } = mapHttpErrorToResponse("RUN_NOT_FOUND");
        res.status(status).json(body);
        return;
      }

      res.status(200).json(record);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * DELETE /v1/runs/:id — permanent deletion. 204 on a real deletion; a
 * missing or already-deleted id gets the same safe 404 as GET, not a
 * fabricated idempotent success.
 */
export function createDeleteRunRouteHandler(deps: RunHistoryRouteDependencies) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const deleted = await deps.runStore.deleteById(req.params.id as string);

      if (!deleted) {
        const { status, body } = mapHttpErrorToResponse("RUN_NOT_FOUND");
        res.status(status).json(body);
        return;
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}
