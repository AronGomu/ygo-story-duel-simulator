import eslint from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".agentsystem/**",
      ".cache/**",
      ".pi/**",
      ".github/skills/**",
      ".github/hooks/**",
      "coverage/**",
      "dist*/**",
      "generated/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "vendor/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs["flat/recommended"],
  ...svelte.configs["flat/prettier"],
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "preserve-caught-error": "off",
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      globals: {
        ...globals.browser,
        __RUNTIME_MANIFEST_SHA256__: "readonly",
        __RUNTIME_SNAPSHOT_ID__: "readonly",
        __ACTIVATION_SNAPSHOT_ID__: "readonly",
        __APP_BUILD_ID__: "readonly",
        __ACTIVE_IMAGE_MANIFEST_SHA256__: "readonly",
        __ACTIVE_IMAGE_MANIFEST__: "readonly",
        __ACTIVE_CARD_TEXTS__: "readonly",
        __RUNTIME_REVISIONS__: "readonly",
      },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
);
