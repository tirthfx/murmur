import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/*/src/**/*.test.{ts,tsx}",
      "apps/*/packaging/**/*.test.ts",
      "packages/*/src/**/*.test.{ts,tsx}",
      "services/*/src/**/*.test.{ts,tsx}",
    ],
    passWithNoTests: true,
  },
});
