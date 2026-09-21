/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the built bundle works from any path: a preview host, a file:// copy, or the
// WebView that Capacitor puts around it.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { host: "0.0.0.0", port: 5173, strictPort: true, hmr: { clientPort: 443 }, cors: true, headers: { "Access-Control-Allow-Origin": "*" }, allowedHosts: true as any },
  preview: { host: "0.0.0.0", port: 4173, strictPort: true },
  build: { outDir: "dist", target: "es2022", cssCodeSplit: false, chunkSizeWarningLimit: 900 },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    testTimeout: 30000,
  },
});
