import { defineConfig } from "vitest/config";

// Separate from vite.config.ts: the rules engine is pure, so tests run in
// plain Node without the Cloudflare/agents Vite plugins.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
