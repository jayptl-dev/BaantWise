import { defineConfig } from "vitest/config";

// Settings for `npm test`. The tests only need plain TypeScript, so this leaves out
// the Cloudflare plugin that vite.config.ts uses for the real app.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
