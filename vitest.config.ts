import { defineConfig } from "vitest/config";

// Scopes the root test command to the backend only. apps/web is a separate
// npm workspace with its own Vitest config (jsdom environment, RTL setup)
// and is run via `npm run test:web`, not this one.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
