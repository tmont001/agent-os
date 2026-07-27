import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Local-development-only proxy: forwards same-origin /v1 requests from the
// Vite dev server to the API's default bind address, so the browser never
// needs the API to add CORS headers. Has no effect on `vite build`. See
// docs/milestones/M3_DESIGN.md Section 3.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/v1": "http://127.0.0.1:3000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
