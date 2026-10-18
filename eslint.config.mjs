import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/features/feed/components/post-composer.tsx"],
    rules: {
      // Draft recovery intentionally hydrates client-only localStorage state after mount.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Copied from pdfjs-dist by scripts/copy-pdf-worker.mjs during the build; minified third-party code (git-ignored).
    "public/pdf.worker.min.mjs",
  ]),
]);

export default eslintConfig;
