import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // amazon-cognito-identity-js still expects Node's `global` to exist.
  define: { global: "globalThis" },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin /api in development, as CloudFront provides in production.
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  test: { environment: "node", include: ["src/**/*.test.js"] },
});
