import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { AIProvider } from "../providers/AIProvider.js";
import type { WorkspaceDefinition } from "../workspaces/WorkspaceDefinition.js";
import type { WorkspacePublicMetadata } from "../workspaces/workspaceCatalog.js";
import { mapHttpErrorToResponse, type HttpErrorCode } from "./mapErrorToResponse.js";
import { createRunsRouteHandler } from "./runsRoute.js";
import { createWorkspacesRouteHandler } from "./workspacesRoute.js";

const MAX_BODY_SIZE = "16kb";

export interface CreateAppDependencies {
  readonly resolveWorkspace: (id: string) => WorkspaceDefinition | undefined;
  readonly aiProvider: AIProvider;
  readonly listWorkspaceCatalog: () => readonly WorkspacePublicMetadata[];
}

interface BodyParserError extends Error {
  readonly type?: string;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return error instanceof Error && typeof (error as BodyParserError).type === "string";
}

/**
 * Only two body-parser failure types are given their own safe HTTP-local
 * code; anything else (e.g. charset.unsupported, encoding.unsupported,
 * entity.verify.failed) is treated as UNEXPECTED rather than assumed to be
 * a JSON-parse problem. The parser's own message/type/body/stack/cause is
 * never exposed either way.
 */
function classifyBodyParserError(error: BodyParserError): HttpErrorCode {
  if (error.type === "entity.too.large") {
    return "PAYLOAD_TOO_LARGE";
  }
  if (error.type === "entity.parse.failed") {
    return "INVALID_JSON";
  }
  return "UNEXPECTED";
}

/**
 * Requires a real application/json media type (params such as charset are
 * ignored, exactly like Express's own req.is()). Vendor/suffix JSON types
 * (e.g. application/vnd.api+json) and near-miss strings (application/jsonp)
 * are deliberately not accepted — the M1 contract is application/json only.
 */
function requireJsonContentType(req: Request, res: Response, next: NextFunction): void {
  if (!req.is("application/json")) {
    const { status, body } = mapHttpErrorToResponse("UNSUPPORTED_MEDIA_TYPE");
    res.status(status).json(body);
    return;
  }
  next();
}

/**
 * Express app factory. Builds and returns a configured application given
 * injected dependencies — it never calls .listen() and never imports a
 * concrete AIProvider adapter itself.
 */
export function createApp(deps: CreateAppDependencies): Express {
  const app = express();

  const runsRouteHandler = createRunsRouteHandler(deps);
  const workspacesRouteHandler = createWorkspacesRouteHandler(deps);

  // Media-type check, JSON body parsing (16kb limit, strict top-level
  // shape), then the handler.
  app.post(
    "/v1/runs",
    requireJsonContentType,
    express.json({ limit: MAX_BODY_SIZE, strict: true }),
    runsRouteHandler
  );

  // Any other method on this same path.
  app.all("/v1/runs", (_req: Request, res: Response) => {
    const { status, body } = mapHttpErrorToResponse("METHOD_NOT_ALLOWED");
    res.status(status).set("Allow", "POST").json(body);
  });

  // Read-only catalog of user-facing workspaces — no body, no params.
  app.get("/v1/workspaces", workspacesRouteHandler);

  app.all("/v1/workspaces", (_req: Request, res: Response) => {
    const { status, body } = mapHttpErrorToResponse("METHOD_NOT_ALLOWED");
    res.status(status).set("Allow", "GET").json(body);
  });

  // Nothing else matched.
  app.use((_req: Request, res: Response) => {
    const { status, body } = mapHttpErrorToResponse("ROUTE_NOT_FOUND");
    res.status(status).json(body);
  });

  // Final error-handling middleware — malformed JSON, oversized bodies, and
  // any exception forwarded via next(error).
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const code = isBodyParserError(error) ? classifyBodyParserError(error) : "UNEXPECTED";
    const { status, body } = mapHttpErrorToResponse(code);
    res.status(status).json(body);
  });

  return app;
}
