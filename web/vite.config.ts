/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SPA with history fallback (default appType 'spa') so /gate?return=tiktok
// resolves to index.html and returns 200 under both `vite dev` and `vite preview`.
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    // deck.generated.json is imported as a module; keep it inlined so there is
    // no extra runtime fetch and it is available offline immediately.
    assetsInlineLimit: 4096,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
