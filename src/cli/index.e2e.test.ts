import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * These tests spawn the real CLI process (via `node --import tsx`). They
 * exercise only the default FakeAIProvider path and the no-key Anthropic
 * misconfiguration path — neither makes a network call, requires a real
 * API key, or requires a real .env file. ANTHROPIC_API_KEY is explicitly
 * stripped from the child's environment so this is deterministic regardless
 * of the host environment.
 */

const { ANTHROPIC_API_KEY: _ignored, ...envWithoutKey } = process.env;

function runCli(args: string[]) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli/index.ts", ...args],
    {
      cwd: process.cwd(),
      env: envWithoutKey,
      encoding: "utf8",
      timeout: 15_000,
    }
  );

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("CLI (end-to-end, fake provider)", () => {
  it(
    "succeeds with the fake provider: exit 0, stdout output, empty stderr",
    () => {
      const { status, stdout, stderr } = runCli(["--workspace", "echo", "--input", "Hello"]);

      expect(status).toBe(0);
      expect(stdout).toBe("Echo: Hello\n");
      expect(stderr).toBe("");
    },
    20_000
  );

  it(
    "succeeds with the job-application-review workspace and the fake provider: exit 0",
    () => {
      const { status, stdout, stderr } = runCli([
        "--workspace",
        "job-application-review",
        "--input",
        "Hello",
      ]);

      expect(status).toBe(0);
      expect(stdout).toBe("Echo: Hello\n");
      expect(stderr).toBe("");
    },
    20_000
  );

  it(
    "reports a deliberate fake-provider failure: exit 1, empty stdout, one safe stderr line",
    () => {
      const { status, stdout, stderr } = runCli([
        "--workspace",
        "echo",
        "--input",
        "Hello",
        "--simulate-failure",
      ]);

      expect(status).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toBe("Error [PROVIDER_ERROR]: The fake provider was configured to fail.\n");
    },
    20_000
  );

  it(
    "reports an unknown workspace: exit 1, empty stdout, safe stderr line",
    () => {
      const { status, stdout, stderr } = runCli([
        "--workspace",
        "does-not-exist",
        "--input",
        "Hello",
      ]);

      expect(status).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toBe('Error [WORKSPACE_NOT_FOUND]: No workspace found for id "does-not-exist".\n');
    },
    20_000
  );

  it(
    "reports blank input: exit 1, empty stdout, safe stderr line",
    () => {
      const { status, stdout, stderr } = runCli(["--workspace", "echo", "--input", ""]);

      expect(status).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toBe("Error [INVALID_INPUT]: Input must not be empty.\n");
    },
    20_000
  );

  it(
    "reports whitespace-only input: exit 1, empty stdout, safe stderr line",
    () => {
      const { status, stdout, stderr } = runCli(["--workspace", "echo", "--input", "   "]);

      expect(status).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toBe("Error [INVALID_INPUT]: Input must not be empty.\n");
    },
    20_000
  );

  it(
    "reports a usage error for a missing --input flag: exit 2, empty stdout",
    () => {
      const { status, stdout, stderr } = runCli(["--workspace", "echo"]);

      expect(status).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toBe("Usage error: --input is required\n");
    },
    20_000
  );

  it(
    "reports a usage error for a missing --workspace flag: exit 2, empty stdout",
    () => {
      const { status, stdout, stderr } = runCli(["--input", "Hello"]);

      expect(status).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toBe("Usage error: --workspace is required\n");
    },
    20_000
  );

  it(
    "reports a usage error for an unsupported --provider value: exit 2",
    () => {
      const { status, stdout, stderr } = runCli([
        "--workspace",
        "echo",
        "--input",
        "Hello",
        "--provider",
        "bogus",
      ]);

      expect(status).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toBe(
        'Usage error: unsupported --provider value "bogus" (expected "fake" or "anthropic")\n'
      );
    },
    20_000
  );

  it(
    "reports a usage error for an unknown CLI flag: exit 2",
    () => {
      const { status, stdout } = runCli([
        "--workspace",
        "echo",
        "--input",
        "Hello",
        "--nonexistent-flag",
      ]);

      expect(status).toBe(2);
      expect(stdout).toBe("");
    },
    20_000
  );

  it(
    "reports a usage error when combining --provider anthropic with --simulate-failure: exit 2",
    () => {
      const { status, stdout, stderr } = runCli([
        "--workspace",
        "echo",
        "--input",
        "Hello",
        "--provider",
        "anthropic",
        "--simulate-failure",
      ]);

      expect(status).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toBe("Usage error: --simulate-failure may only be used with --provider fake\n");
    },
    20_000
  );

  it(
    "safely reports PROVIDER_MISCONFIGURED when Anthropic is selected without an API key, without loading the SDK or printing a stack trace",
    () => {
      const { status, stdout, stderr } = runCli([
        "--workspace",
        "echo",
        "--input",
        "Hello",
        "--provider",
        "anthropic",
      ]);

      expect(status).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toBe("Error [PROVIDER_MISCONFIGURED]: ANTHROPIC_API_KEY is not set\n");
      expect(stderr).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    },
    20_000
  );
});
