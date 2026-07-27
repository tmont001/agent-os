import { describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { createApp } from "./createApp.js";
import { FakeAIProvider } from "../providers/FakeAIProvider.js";
import { resolveWorkspace } from "../workspaces/resolveWorkspace.js";
import type { AIProvider } from "../providers/AIProvider.js";

/**
 * All tests here run entirely in-process against the Express app object via
 * Supertest — no real network socket, no live Anthropic call. Provider
 * failure modes beyond FakeAIProvider's existing success/failure use small
 * test-local doubles (per M1_DESIGN.md Section 6) rather than modifying
 * FakeAIProvider.
 */

function unavailableProviderDouble(): AIProvider {
  return {
    generate: vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: "The AI provider is temporarily unavailable. Please try again.",
        retryable: true,
      },
    }),
  };
}

function throwingProviderDouble(): AIProvider {
  return {
    generate: vi.fn().mockRejectedValue(new Error("boom")),
  };
}

function buildApp(aiProvider: AIProvider = new FakeAIProvider()) {
  return createApp({ resolveWorkspace, aiProvider });
}

describe("createApp", () => {
  describe("HTTP success", () => {
    it("returns 200 with the correct body and Content-Type for a valid Echo request", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
      expect(response.body).toEqual({ output: "Echo: Hello" });
    });
  });

  describe("shape validation", () => {
    it("returns 400 VALIDATION_ERROR for a missing body", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json");

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR for a missing workspaceId", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ input: "Hello" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR for a missing input", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR for a wrong field type", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: 123 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects an unknown 'provider' field and never calls the provider (provider cannot be client-selected)", async () => {
      const provider = unavailableProviderDouble();

      const response = await supertest(createApp({ resolveWorkspace, aiProvider: provider }))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello", provider: "anthropic" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(provider.generate).not.toHaveBeenCalled();
    });

    it("rejects an unknown 'model' field", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello", model: "claude-sonnet-5" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("input validation delegated to the application", () => {
    it("returns 400 INVALID_INPUT for empty input and never calls the provider", async () => {
      const provider = unavailableProviderDouble();

      const response = await supertest(createApp({ resolveWorkspace, aiProvider: provider }))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_INPUT");
      expect(provider.generate).not.toHaveBeenCalled();
    });

    it("returns 400 INVALID_INPUT for whitespace-only input and never calls the provider", async () => {
      const provider = unavailableProviderDouble();

      const response = await supertest(createApp({ resolveWorkspace, aiProvider: provider }))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "   " });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_INPUT");
      expect(provider.generate).not.toHaveBeenCalled();
    });
  });

  describe("parser/media behavior", () => {
    it("returns 400 INVALID_JSON for a malformed JSON body", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send("{not valid json");

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_JSON");
    });

    it("returns 413 PAYLOAD_TOO_LARGE for a body over 16kb", async () => {
      const oversizedInput = "x".repeat(20_000);

      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: oversizedInput });

      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("returns 500 UNEXPECTED (not INVALID_JSON) for an unrecognized body-parser failure (unsupported charset)", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json; charset=bogus-charset-xyz")
        .send('{"workspaceId":"echo","input":"Hello"}');

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("UNEXPECTED");
      expect(JSON.stringify(response.body)).not.toContain("charset");
    });

    describe("media-type matching (application/json only, real matching, not substring)", () => {
      it("accepts application/json", async () => {
        const response = await supertest(buildApp())
          .post("/v1/runs")
          .set("Content-Type", "application/json")
          .send({ workspaceId: "echo", input: "Hello" });

        expect(response.status).toBe(200);
      });

      it("accepts application/json; charset=utf-8", async () => {
        const response = await supertest(buildApp())
          .post("/v1/runs")
          .set("Content-Type", "application/json; charset=utf-8")
          .send({ workspaceId: "echo", input: "Hello" });

        expect(response.status).toBe(200);
      });

      it("rejects application/jsonp with 415 UNSUPPORTED_MEDIA_TYPE", async () => {
        const response = await supertest(buildApp())
          .post("/v1/runs")
          .set("Content-Type", "application/jsonp")
          .send('{"workspaceId":"echo","input":"Hello"}');

        expect(response.status).toBe(415);
        expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
      });

      it("rejects text/application/json with 415 UNSUPPORTED_MEDIA_TYPE", async () => {
        const response = await supertest(buildApp())
          .post("/v1/runs")
          .set("Content-Type", "text/application/json")
          .send('{"workspaceId":"echo","input":"Hello"}');

        expect(response.status).toBe(415);
        expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
      });

      it("rejects a missing Content-Type with 415 UNSUPPORTED_MEDIA_TYPE", async () => {
        const response = await supertest(buildApp()).post("/v1/runs");

        expect(response.status).toBe(415);
        expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
      });

      it("rejects a vendor/suffix JSON media type (application/vnd.api+json) with 415", async () => {
        const response = await supertest(buildApp())
          .post("/v1/runs")
          .set("Content-Type", "application/vnd.api+json")
          .send('{"workspaceId":"echo","input":"Hello"}');

        expect(response.status).toBe(415);
        expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
      });
    });
  });

  describe("application/provider mapping", () => {
    it("returns 404 WORKSPACE_NOT_FOUND for an unknown workspace and never calls the provider", async () => {
      const provider = unavailableProviderDouble();

      const response = await supertest(createApp({ resolveWorkspace, aiProvider: provider }))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "does-not-exist", input: "Hello" });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("WORKSPACE_NOT_FOUND");
      expect(provider.generate).not.toHaveBeenCalled();
    });

    it("returns 502 PROVIDER_ERROR for the existing FakeAIProvider failure mode", async () => {
      const app = createApp({
        resolveWorkspace,
        aiProvider: new FakeAIProvider({ behavior: "failure" }),
      });

      const response = await supertest(app)
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      expect(response.status).toBe(502);
      expect(response.body.error.code).toBe("PROVIDER_ERROR");
      expect(response.body.error.retryable).toBe(false);
    });

    it("returns 503 PROVIDER_UNAVAILABLE for a test-local unavailable-provider double", async () => {
      const app = createApp({ resolveWorkspace, aiProvider: unavailableProviderDouble() });

      const response = await supertest(app)
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(response.body.error.retryable).toBe(true);
    });

    it("returns 500 UNEXPECTED for a test-local throwing-provider double, without a stack trace", async () => {
      const app = createApp({ resolveWorkspace, aiProvider: throwingProviderDouble() });

      const response = await supertest(app)
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("UNEXPECTED");
      expect(JSON.stringify(response.body)).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    });
  });

  describe("routing", () => {
    it("returns 404 ROUTE_NOT_FOUND for an unknown route", async () => {
      const response = await supertest(buildApp()).get("/v1/does-not-exist");

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    });

    it("returns 405 METHOD_NOT_ALLOWED with an Allow: POST header for GET /v1/runs", async () => {
      const response = await supertest(buildApp()).get("/v1/runs");

      expect(response.status).toBe(405);
      expect(response.body.error.code).toBe("METHOD_NOT_ALLOWED");
      expect(response.headers["allow"]).toBe("POST");
    });

    it("returns application/json Content-Type on both success and error responses", async () => {
      const app = buildApp();

      const success = await supertest(app)
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });
      const error = await supertest(app).get("/v1/does-not-exist");

      expect(success.headers["content-type"]).toMatch(/application\/json/);
      expect(error.headers["content-type"]).toMatch(/application\/json/);
    });
  });

  describe("safety", () => {
    it("never leaks cause, stack traces, secrets, or prompt content in an error response", async () => {
      const secretLikeInput = "sk-ant-super-secret-should-not-leak";
      const app = createApp({ resolveWorkspace, aiProvider: throwingProviderDouble() });

      const response = await supertest(app)
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: secretLikeInput });

      const raw = JSON.stringify(response.body);
      expect(raw).not.toContain(secretLikeInput);
      expect(raw).not.toContain("cause");
      expect(raw).not.toMatch(/at .*\(.*:\d+:\d+\)/);
      expect(Object.keys(response.body.error)).toEqual(["code", "message", "retryable"]);
    });
  });
});
