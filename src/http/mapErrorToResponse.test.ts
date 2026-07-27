import { describe, expect, it } from "vitest";
import {
  mapAgentOsErrorToResponse,
  mapHttpErrorToResponse,
  type HttpErrorCode,
} from "./mapErrorToResponse.js";
import type { AgentOsError } from "../errors/AgentOsError.js";

describe("mapHttpErrorToResponse", () => {
  const cases: ReadonlyArray<[HttpErrorCode, number, string]> = [
    ["INVALID_JSON", 400, "Request body must contain valid JSON."],
    [
      "VALIDATION_ERROR",
      400,
      "Request body must contain only workspaceId and input as strings.",
    ],
    ["UNSUPPORTED_MEDIA_TYPE", 415, "Content-Type must be application/json."],
    ["PAYLOAD_TOO_LARGE", 413, "Request body is too large."],
    ["ROUTE_NOT_FOUND", 404, "Route not found."],
    ["METHOD_NOT_ALLOWED", 405, "Method not allowed."],
    ["UNEXPECTED", 500, "An unexpected error occurred."],
  ];

  it.each(cases)("maps %s to the exact status and message", (code, expectedStatus, expectedMessage) => {
    const { status, body } = mapHttpErrorToResponse(code);

    expect(status).toBe(expectedStatus);
    expect(body).toEqual({
      error: { code, message: expectedMessage, retryable: false },
    });
  });
});

describe("mapAgentOsErrorToResponse", () => {
  it("maps INVALID_INPUT to 400", () => {
    const error: AgentOsError = {
      code: "INVALID_INPUT",
      message: "Input must not be empty.",
      retryable: false,
    };

    const { status, body } = mapAgentOsErrorToResponse(error);

    expect(status).toBe(400);
    expect(body).toEqual({
      error: { code: "INVALID_INPUT", message: "Input must not be empty.", retryable: false },
    });
  });

  it("maps WORKSPACE_NOT_FOUND to 404", () => {
    const error: AgentOsError = {
      code: "WORKSPACE_NOT_FOUND",
      message: "No workspace found.",
      retryable: false,
    };

    expect(mapAgentOsErrorToResponse(error).status).toBe(404);
  });

  it("maps PROVIDER_UNAVAILABLE to 503", () => {
    const error: AgentOsError = {
      code: "PROVIDER_UNAVAILABLE",
      message: "unavailable",
      retryable: true,
    };

    expect(mapAgentOsErrorToResponse(error).status).toBe(503);
  });

  it("maps PROVIDER_ERROR to 502", () => {
    const error: AgentOsError = {
      code: "PROVIDER_ERROR",
      message: "error",
      retryable: false,
    };

    expect(mapAgentOsErrorToResponse(error).status).toBe(502);
  });

  it("never includes cause in the mapped response body, even when present on the input error", () => {
    const error: AgentOsError = {
      code: "PROVIDER_ERROR",
      message: "error",
      retryable: false,
      cause: new Error("raw SDK detail"),
    };

    const { body } = mapAgentOsErrorToResponse(error);

    expect(body).toEqual({ error: { code: "PROVIDER_ERROR", message: "error", retryable: false } });
    expect(JSON.stringify(body)).not.toContain("raw SDK detail");
  });

  it("fails closed to UNEXPECTED/500 if a PROVIDER_MISCONFIGURED error somehow reaches the mapper", () => {
    const error: AgentOsError = {
      code: "PROVIDER_MISCONFIGURED",
      message: "ANTHROPIC_API_KEY is not set",
      retryable: false,
    };

    const { status, body } = mapAgentOsErrorToResponse(error);

    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: "UNEXPECTED", message: "An unexpected error occurred.", retryable: false },
    });
  });

  it("never exposes PROVIDER_MISCONFIGURED or its original message in the serialized response", () => {
    const error: AgentOsError = {
      code: "PROVIDER_MISCONFIGURED",
      message: "ANTHROPIC_API_KEY is not set",
      retryable: false,
    };

    const { body } = mapAgentOsErrorToResponse(error);
    const raw = JSON.stringify(body);

    expect(raw).not.toContain("PROVIDER_MISCONFIGURED");
    expect(raw).not.toContain("ANTHROPIC_API_KEY is not set");
  });
});
