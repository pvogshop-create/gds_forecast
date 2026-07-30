import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Scoped explicitly. Without this, Vitest's default glob
    // (**/*.{test,spec}.?(c|m)[jt]s?(x)) sweeps up e2e/*.spec.ts and tries to
    // run the Playwright suite under Vitest, which dies on the
    // @playwright/test import. Playwright owns e2e/, Vitest owns src/.
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
