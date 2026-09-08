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

    // Generated Cloudflare build output — tens of thousands of lines of
    // bundled vendor code, none of it ours to lint.
    ".open-next/**",
    ".wrangler/**",
    "cloudflare-env.d.ts",

    // The worker is a separate project with its own tsconfig and its own
    // typecheck step in CI.
    "worker/**",
  ]),
]);

export default eslintConfig;
