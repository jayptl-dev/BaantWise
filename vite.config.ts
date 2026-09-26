import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    // Google's advice for trying its sign-in button on http://localhost.
    headers: { "Referrer-Policy": "no-referrer-when-downgrade" },
  },
});
