import { describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { createApp } from "./createApp.js";
import { FakeAIProvider } from "../providers/FakeAIProvider.js";
import { resolveWorkspace } from "../workspaces/resolveWorkspace.js";
import { listWorkspaceCatalog } from "../workspaces/workspaceCatalog.js";
import { InMemoryRunStore } from "../runs/InMemoryRunStore.js";
import type { AIProvider } from "../providers/AIProvider.js";
import type { RunStore } from "../runs/RunStore.js";

/**
 * All tests here run entirely in-process against the Express app object via
 * Supertest — no real network socket, no live Anthropic call, no real
 * SQLite file. Provider failure modes beyond FakeAIProvider's existing
 * success/failure use small test-local doubles (per M1_DESIGN.md Section
 * 6) rather than modifying FakeAIProvider; run-store failure modes use an
 * equivalent test-local double rather than modifying InMemoryRunStore.
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

function throwingRunStore(): RunStore {
  const failure = () => Promise.reject(new Error("disk is full"));
  return {
    save: vi.fn(failure),
    list: vi.fn(failure),
    getById: vi.fn(failure),
    deleteById: vi.fn(failure),
  };
}

function buildApp(
  aiProvider: AIProvider = new FakeAIProvider(),
  runStore: RunStore = new InMemoryRunStore()
) {
  return createApp({ resolveWorkspace, aiProvider, listWorkspaceCatalog, runStore });
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
      expect(response.body).toEqual({
        output: "Echo: Hello",
        runId: expect.any(String),
        persisted: true,
      });
    });
  });

  describe("job-application-review workspace", () => {
    it("returns 200 for a valid job-application-review request", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "job-application-review", input: "Hello" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        output: "Echo: Hello",
        runId: expect.any(String),
        persisted: true,
      });
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

      const response = await supertest(buildApp(provider))
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

    it("rejects a client-supplied 'id' field", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello", id: "not-allowed" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a client-supplied 'createdAt' field", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello", createdAt: "2024-01-01T00:00:00.000Z" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a client-supplied 'persisted' field", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello", persisted: true });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("input validation delegated to the application", () => {
    it("returns 400 INVALID_INPUT for empty input and never calls the provider", async () => {
      const provider = unavailableProviderDouble();

      const response = await supertest(buildApp(provider))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_INPUT");
      expect(provider.generate).not.toHaveBeenCalled();
    });

    it("returns 400 INVALID_INPUT for whitespace-only input and never calls the provider", async () => {
      const provider = unavailableProviderDouble();

      const response = await supertest(buildApp(provider))
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

      const response = await supertest(buildApp(provider))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "does-not-exist", input: "Hello" });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("WORKSPACE_NOT_FOUND");
      expect(provider.generate).not.toHaveBeenCalled();
    });

    it("returns 502 PROVIDER_ERROR for the existing FakeAIProvider failure mode", async () => {
      const app = buildApp(new FakeAIProvider({ behavior: "failure" }));

      const response = await supertest(app)
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      expect(response.status).toBe(502);
      expect(response.body.error.code).toBe("PROVIDER_ERROR");
      expect(response.body.error.retryable).toBe(false);
    });

    it("returns 503 PROVIDER_UNAVAILABLE for a test-local unavailable-provider double", async () => {
      const app = buildApp(unavailableProviderDouble());

      const response = await supertest(app)
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(response.body.error.retryable).toBe(true);
    });

    it("returns 500 UNEXPECTED for a test-local throwing-provider double, without a stack trace", async () => {
      const app = buildApp(throwingProviderDouble());

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

    it("returns 405 METHOD_NOT_ALLOWED with an Allow: GET, POST header for PUT /v1/runs", async () => {
      const response = await supertest(buildApp()).put("/v1/runs");

      expect(response.status).toBe(405);
      expect(response.body.error.code).toBe("METHOD_NOT_ALLOWED");
      expect(response.headers["allow"]).toBe("GET, POST");
    });

    it("returns 405 METHOD_NOT_ALLOWED with an Allow: GET, DELETE header for POST /v1/runs/:id", async () => {
      const response = await supertest(buildApp()).post("/v1/runs/some-id");

      expect(response.status).toBe(405);
      expect(response.body.error.code).toBe("METHOD_NOT_ALLOWED");
      expect(response.headers["allow"]).toBe("GET, DELETE");
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
      const app = buildApp(throwingProviderDouble());

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

  describe("GET /v1/workspaces", () => {
    it("returns 200 with the deterministic public catalog", async () => {
      const response = await supertest(buildApp()).get("/v1/workspaces");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        workspaces: [
          {
            id: "job-application-review",
            displayName: "Job Application Review",
            description: expect.any(String),
          },
          {
            id: "research-brief",
            displayName: "Research Brief",
            description: expect.any(String),
          },
        ],
      });
    });

    it("never includes the echo workspace", async () => {
      const response = await supertest(buildApp()).get("/v1/workspaces");

      expect(
        (response.body.workspaces as Array<{ id: string }>).some((entry) => entry.id === "echo")
      ).toBe(false);
    });

    it("exposes no instructions or other internal/execution fields", async () => {
      const response = await supertest(buildApp()).get("/v1/workspaces");

      for (const entry of response.body.workspaces as Array<Record<string, unknown>>) {
        expect(Object.keys(entry).sort()).toEqual(["description", "displayName", "id"]);
      }
    });

    it("returns the same order on repeated requests", async () => {
      const app = buildApp();

      const first = await supertest(app).get("/v1/workspaces");
      const second = await supertest(app).get("/v1/workspaces");

      expect(first.body).toEqual(second.body);
    });

    it("never calls the AI provider", async () => {
      const provider = unavailableProviderDouble();

      await supertest(buildApp(provider)).get("/v1/workspaces");

      expect(provider.generate).not.toHaveBeenCalled();
    });

    it("returns 405 METHOD_NOT_ALLOWED with an Allow: GET header for POST /v1/workspaces", async () => {
      const response = await supertest(buildApp()).post("/v1/workspaces");

      expect(response.status).toBe(405);
      expect(response.body.error.code).toBe("METHOD_NOT_ALLOWED");
      expect(response.headers["allow"]).toBe("GET");
    });
  });

  describe("run history persistence via POST /v1/runs", () => {
    it("persists exactly workspaceId/input/output for a successful run", async () => {
      const runStore = new InMemoryRunStore();

      const response = await supertest(buildApp(new FakeAIProvider(), runStore))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      const saved = await runStore.getById(response.body.runId as string);
      expect(saved).toEqual({
        id: response.body.runId,
        workspaceId: "echo",
        input: "Hello",
        output: "Echo: Hello",
        createdAt: saved?.createdAt,
      });
    });

    it("returns a non-empty runId and persisted:true on a successful save", async () => {
      const response = await supertest(buildApp())
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      expect(response.body.persisted).toBe(true);
      expect(typeof response.body.runId).toBe("string");
      expect((response.body.runId as string).length).toBeGreaterThan(0);
    });

    it("creates no history record when the provider fails", async () => {
      const runStore = new InMemoryRunStore();

      await supertest(buildApp(new FakeAIProvider({ behavior: "failure" }), runStore))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      expect(await runStore.list()).toEqual([]);
    });

    it("creates no history record when the workspace is unknown", async () => {
      const runStore = new InMemoryRunStore();

      await supertest(buildApp(new FakeAIProvider(), runStore))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "does-not-exist", input: "Hello" });

      expect(await runStore.list()).toEqual([]);
    });

    it("returns HTTP 200 with the generated output, runId:null, and persisted:false when saving fails", async () => {
      const response = await supertest(buildApp(new FakeAIProvider(), throwingRunStore()))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ output: "Echo: Hello", runId: null, persisted: false });
    });

    it("never exposes the raw storage failure text", async () => {
      const response = await supertest(buildApp(new FakeAIProvider(), throwingRunStore()))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      expect(JSON.stringify(response.body)).not.toContain("disk is full");
    });
  });

  describe("GET /v1/runs (history list)", () => {
    it("returns an empty list when no runs have been saved", async () => {
      const response = await supertest(buildApp()).get("/v1/runs");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ runs: [] });
    });

    it("returns multiple summaries newest-first, in RunStore.list()'s order", async () => {
      const runStore = new InMemoryRunStore();
      const app = buildApp(new FakeAIProvider(), runStore);

      await supertest(app)
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "first" });
      await supertest(app)
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "second" });

      const response = await supertest(app).get("/v1/runs");
      const expected = await runStore.list();

      expect(response.body).toEqual({ runs: expected });
      expect(response.body.runs).toHaveLength(2);
    });

    it("returns exactly id, workspaceId, createdAt, and inputPreview — never input or output", async () => {
      const runStore = new InMemoryRunStore();
      await supertest(buildApp(new FakeAIProvider(), runStore))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      const response = await supertest(buildApp(new FakeAIProvider(), runStore)).get("/v1/runs");

      expect(response.body.runs).toHaveLength(1);
      for (const entry of response.body.runs as Array<Record<string, unknown>>) {
        expect(Object.keys(entry).sort()).toEqual([
          "createdAt",
          "id",
          "inputPreview",
          "workspaceId",
        ]);
      }
    });

    it("returns a safe 500 UNEXPECTED, without raw storage detail, when RunStore.list() throws", async () => {
      const response = await supertest(buildApp(new FakeAIProvider(), throwingRunStore())).get(
        "/v1/runs"
      );

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("UNEXPECTED");
      expect(JSON.stringify(response.body)).not.toContain("disk is full");
    });
  });

  describe("GET /v1/runs/:id", () => {
    it("returns the full existing record", async () => {
      const runStore = new InMemoryRunStore();
      const postResponse = await supertest(buildApp(new FakeAIProvider(), runStore))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      const response = await supertest(buildApp(new FakeAIProvider(), runStore)).get(
        `/v1/runs/${postResponse.body.runId as string}`
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: postResponse.body.runId,
        workspaceId: "echo",
        input: "Hello",
        output: "Echo: Hello",
        createdAt: expect.any(String),
      });
    });

    it("returns 404 RUN_NOT_FOUND for a missing record", async () => {
      const response = await supertest(buildApp()).get("/v1/runs/does-not-exist");

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("RUN_NOT_FOUND");
    });

    it("returns the same 404 RUN_NOT_FOUND for an opaque, malformed-looking id", async () => {
      const response = await supertest(buildApp()).get(
        "/v1/runs/not-a-real-uuid-!!!-%20-☃"
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("RUN_NOT_FOUND");
    });

    it("returns a safe 500 UNEXPECTED, without raw storage detail, when RunStore.getById() throws", async () => {
      const response = await supertest(buildApp(new FakeAIProvider(), throwingRunStore())).get(
        "/v1/runs/some-id"
      );

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("UNEXPECTED");
      expect(JSON.stringify(response.body)).not.toContain("disk is full");
    });
  });

  describe("DELETE /v1/runs/:id", () => {
    it("returns 204 with an empty body for an existing record", async () => {
      const runStore = new InMemoryRunStore();
      const postResponse = await supertest(buildApp(new FakeAIProvider(), runStore))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });

      const response = await supertest(buildApp(new FakeAIProvider(), runStore)).delete(
        `/v1/runs/${postResponse.body.runId as string}`
      );

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
      expect(response.text).toBe("");
    });

    it("actually removes the record", async () => {
      const runStore = new InMemoryRunStore();
      const postResponse = await supertest(buildApp(new FakeAIProvider(), runStore))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });
      const runId = postResponse.body.runId as string;

      await supertest(buildApp(new FakeAIProvider(), runStore)).delete(`/v1/runs/${runId}`);

      expect(await runStore.getById(runId)).toBeUndefined();
    });

    it("returns 404 RUN_NOT_FOUND for a missing record", async () => {
      const response = await supertest(buildApp()).delete("/v1/runs/does-not-exist");

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("RUN_NOT_FOUND");
    });

    it("returns 404 RUN_NOT_FOUND on repeated deletion", async () => {
      const runStore = new InMemoryRunStore();
      const postResponse = await supertest(buildApp(new FakeAIProvider(), runStore))
        .post("/v1/runs")
        .set("Content-Type", "application/json")
        .send({ workspaceId: "echo", input: "Hello" });
      const runId = postResponse.body.runId as string;
      const app = buildApp(new FakeAIProvider(), runStore);

      const first = await supertest(app).delete(`/v1/runs/${runId}`);
      const second = await supertest(app).delete(`/v1/runs/${runId}`);

      expect(first.status).toBe(204);
      expect(second.status).toBe(404);
      expect(second.body.error.code).toBe("RUN_NOT_FOUND");
    });

    it("returns a safe 500 UNEXPECTED, without raw storage detail, when RunStore.deleteById() throws", async () => {
      const response = await supertest(buildApp(new FakeAIProvider(), throwingRunStore())).delete(
        "/v1/runs/some-id"
      );

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("UNEXPECTED");
      expect(JSON.stringify(response.body)).not.toContain("disk is full");
    });
  });
});
