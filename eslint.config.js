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
    // The admin console's pages run in a browser (TM-11).
    files: ["services/local-server/admin/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        location: "readonly",
        fetch: "readonly",
        Node: "readonly",
        Event: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Blob: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  prettier,
);
