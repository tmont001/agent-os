import { createServer, type Server } from "node:net";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * server.ts is never imported directly by a test — importing a module that
 * calls app.listen() at startup would trigger a real listening server as a
 * side effect of the import. These tests instead spawn it as a real child
 * process (the same pattern M0 validated for the CLI) and verify the
 * fail-before-listen configuration scenarios. None of them make a network
 * request or construct AnthropicAIProvider.
 *
 * The inherited base environment has every server-owned variable
 * (AI_PROVIDER, ANTHROPIC_API_KEY, PORT) stripped, so each test controls
 * exactly the variables it cares about regardless of the host environment.
 */

const {
  AI_PROVIDER: _ignoredProvider,
  ANTHROPIC_API_KEY: _ignoredKey,
  PORT: _ignoredPort,
  ...baseEnv
} = process.env;

interface ServerRunResult {
  /** Exit code, or null if the process never exited normally (killed/timed out). */
  readonly status: number | null;
  /** Signal that terminated the process, or null if it exited normally. */
  readonly signal: NodeJS.Signals | null;
  /** Set if the process could not be spawned at all (e.g. ENOENT). */
  readonly error: Error | undefined;
  readonly stdout: string;
  readonly stderr: string;
  /** True if spawnSync's own timeout killed the process. */
  readonly timedOut: boolean;
}

function runServer(env: NodeJS.ProcessEnv): ServerRunResult {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/http/server.ts"], {
    cwd: process.cwd(),
    env: { ...baseEnv, ...env },
    encoding: "utf8",
    timeout: 5_000,
  });

  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: result.signal === "SIGTERM" && result.status === null && result.error === undefined,
  };
}

function expectCleanFailureBeforeListen(result: ServerRunResult): void {
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stdout).not.toContain("listening");
  expect(result.stderr).not.toMatch(/at .*\(.*:\d+:\d+\)/);
}

describe("server.ts startup (child process)", () => {
  it(
    "fails before listen when AI_PROVIDER is missing",
    () => {
      const result = runServer({});

      expectCleanFailureBeforeListen(result);
      expect(result.stderr).toContain("AI_PROVIDER is required");
    },
    10_000
  );

  it(
    "fails before listen when AI_PROVIDER is an unsupported value",
    () => {
      const result = runServer({ AI_PROVIDER: "bogus" });

      expectCleanFailureBeforeListen(result);
      expect(result.stderr).toContain("Unsupported AI_PROVIDER value");
    },
    10_000
  );

  it(
    "fails before listen when AI_PROVIDER=anthropic has no ANTHROPIC_API_KEY, with no network request",
    () => {
      const result = runServer({ AI_PROVIDER: "anthropic" });

      expectCleanFailureBeforeListen(result);
      expect(result.stderr).toContain("ANTHROPIC_API_KEY is required");
    },
    10_000
  );

  it(
    "fails before listen when AI_PROVIDER=anthropic has a whitespace-only ANTHROPIC_API_KEY",
    () => {
      const result = runServer({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "   " });

      expectCleanFailureBeforeListen(result);
      expect(result.stderr).toContain("ANTHROPIC_API_KEY is required");
    },
    10_000
  );

  describe.each([
    ["PORT=0", "0"],
    ["PORT=65536", "65536"],
    ["PORT=abc", "abc"],
  ])("invalid %s", (_label, portValue) => {
    it(
      `fails before listen for an invalid PORT (${portValue})`,
      () => {
        const result = runServer({ AI_PROVIDER: "fake", PORT: portValue });

        expectCleanFailureBeforeListen(result);
        expect(result.stderr).toContain("PORT must be an integer from 1 through 65535");
      },
      10_000
    );
  });

  it(
    "fails safely, with no lingering process, when the configured PORT is already occupied",
    async () => {
      const occupyingServer: Server = createServer();
      const occupiedPort = await new Promise<number>((resolve, reject) => {
        occupyingServer.once("error", reject);
        occupyingServer.listen(0, "127.0.0.1", () => {
          const address = occupyingServer.address();
          if (address === null || typeof address === "string") {
            reject(new Error("expected an AddressInfo from an ephemeral TCP listener"));
            return;
          }
          resolve(address.port);
        });
      });

      try {
        const result = runServer({ AI_PROVIDER: "fake", PORT: String(occupiedPort) });

        // Unlike the pure configuration-validation cases above, .listen() is
        // genuinely attempted here, and on this platform the 'listening'
        // callback can fire before the asynchronous EADDRINUSE error
        // surfaces — so stdout is not asserted empty. What matters is that
        // the process still reports the failure safely and exits
        // non-lingering with a nonzero code, never a raw error or stack.
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Configuration error: unable to start HTTP server.");
        expect(result.stderr).not.toContain("EADDRINUSE");
        expect(result.stderr).not.toMatch(/at .*\(.*:\d+:\d+\)/);
      } finally {
        await new Promise<void>((resolve) => occupyingServer.close(() => resolve()));
      }
    },
    10_000
  );
});
