import { createApp } from "./createApp.js";
import { resolveWorkspace } from "../workspaces/resolveWorkspace.js";
import { listWorkspaceCatalog } from "../workspaces/workspaceCatalog.js";
import { FakeAIProvider } from "../providers/FakeAIProvider.js";
import { SqliteRunStore } from "../runs/SqliteRunStore.js";
import type { AIProvider } from "../providers/AIProvider.js";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const DEFAULT_RUN_STORE_PATH = "data/runs.sqlite3";

/**
 * The only file that reads process.env or calls app.listen(). Configuration
 * is validated once, at startup, before listen — a server that cannot serve
 * requests correctly must never accept a connection (M1_DESIGN.md Section 5).
 */
function failStartup(message: string): void {
  process.stderr.write(`Configuration error: ${message}\n`);
  process.exitCode = 1;
}

function readPort(): number | undefined {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") {
    return DEFAULT_PORT;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    failStartup(`PORT must be an integer from 1 through 65535 (received "${raw}").`);
    return undefined;
  }

  return parsed;
}

function readRunStorePath(): string {
  const raw = process.env.RUN_STORE_PATH;
  return raw === undefined || raw === "" ? DEFAULT_RUN_STORE_PATH : raw;
}

async function buildAiProvider(): Promise<AIProvider | undefined> {
  const aiProviderName = process.env.AI_PROVIDER;

  if (aiProviderName === undefined) {
    failStartup('AI_PROVIDER is required (expected "fake" or "anthropic").');
    return undefined;
  }

  if (aiProviderName !== "fake" && aiProviderName !== "anthropic") {
    failStartup(
      `Unsupported AI_PROVIDER value "${aiProviderName}" (expected "fake" or "anthropic").`
    );
    return undefined;
  }

  if (aiProviderName === "fake") {
    return new FakeAIProvider();
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    failStartup("ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic.");
    return undefined;
  }

  // Dynamic import: the fake path above never reaches this line, so it
  // never loads the Anthropic adapter or the @anthropic-ai/sdk module.
  const { AnthropicAIProvider } = await import("../providers/AnthropicAIProvider.js");
  return new AnthropicAIProvider({ apiKey });
}

async function main(): Promise<void> {
  const port = readPort();
  if (port === undefined) {
    return;
  }

  const aiProvider = await buildAiProvider();
  if (aiProvider === undefined) {
    return;
  }

  // Constructed once for the process lifetime. A failure here (unsupported
  // schema version, unwritable path, etc.) must fail startup rather than
  // silently run without persistence — it propagates to main().catch below.
  const runStore = new SqliteRunStore(readRunStorePath());

  const app = createApp({ resolveWorkspace, aiProvider, listWorkspaceCatalog, runStore });
  const httpServer = app.listen(port, HOST, () => {
    process.stdout.write(`Agent OS HTTP server listening on http://${HOST}:${port}\n`);
  });

  // Binding can fail asynchronously (e.g. EADDRINUSE) after this function
  // has already returned. Never expose the raw Node error or retry —
  // report safely and let the process exit with a nonzero code.
  httpServer.on("error", () => {
    process.stderr.write("Configuration error: unable to start HTTP server.\n");
    process.exitCode = 1;
  });
}

main().catch(() => {
  process.stderr.write("Configuration error: an unexpected error occurred during startup.\n");
  process.exitCode = 1;
});
