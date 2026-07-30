import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated, git-ignored, and not ours to fix. `supabase start` drops a
    // bundled edge-runtime file here that alone accounts for ~190 lint errors
    // in minified code, drowning out every real finding in the source tree.
    "supabase/.temp/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
