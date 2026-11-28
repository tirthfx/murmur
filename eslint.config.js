import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/out/**", "**/.vite/**", "**/coverage/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Plain Node scripts run outside the app.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Buffer: "readonly",
        performance: "readonly",
      },
    },
  },
  {
    // The `murmur-mcp` command is a plain CommonJS script that clients start.
    files: ["apps/desktop/packaging/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { process: "readonly", require: "readonly" },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  prettier,
);
