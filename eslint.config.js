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
    // SW-08: only `services/` and the team client folder may name a team backend's SDK, and only
    // the team client folder (and its tests) may load the local server's code.
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    ignores: ["apps/desktop/src/main/team/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@supabase/*", "supabase", "supabase-js"],
              message:
                "A team backend's SDK is used only in services/ and in the team client folder.",
            },
            {
              group: ["**/services/local-server/**"],
              message: "Reach the team server through TeamClient, not its code.",
            },
          ],
        },
      ],
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
