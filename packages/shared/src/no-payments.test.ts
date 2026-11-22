import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Murmur has no payment, billing or subscription code (TM-25, and the project rules). This looks
 * through the tracked source for the names such code would use and for payment libraries in any
 * package.json, so adding one fails here, in CI, before review.
 */
const root = new URL("../../../", import.meta.url).pathname;

const tracked = (): string[] =>
  execFileSync(
    "git",
    ["ls-files", "-z", "apps", "packages", "services", "scripts", "native", "package.json"],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);

const PAYMENT_LIBRARIES =
  /^(stripe|@stripe\/.*|paypal.*|@paypal\/.*|braintree.*|@paddle\/.*|paddle.*|chargebee.*|recurly.*|@lemonsqueezy\/.*|lemonsqueezy.*|square|squareup|razorpay|adyen.*|@adyen\/.*|revenuecat.*|react-native-purchases)$/i;

const PAYMENT_WORDS =
  /\b(stripe|paypal|braintree|paddle|chargebee|recurly|lemonsqueezy|storekit|apple ?pay|google ?pay)\b|credit ?card|card ?number|\bcvv\b|\/billing\b|\/checkout\b|\/subscribe\b|createSubscription|subscriptionId|paymentMethod|payment_intent/i;

describe("no payments", () => {
  const files = tracked();

  it("has no payment library in any package.json", () => {
    const manifests = files.filter((file) => file.endsWith("package.json"));
    expect(manifests.length).toBeGreaterThan(3);
    for (const file of manifests) {
      const json = JSON.parse(readFileSync(root + file, "utf8")) as Record<
        string,
        Record<string, string> | undefined
      >;
      const names = [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
      ].flatMap((key) => Object.keys(json[key] ?? {}));
      expect(
        names.filter((name) => PAYMENT_LIBRARIES.test(name)),
        file,
      ).toEqual([]);
    }
  });

  it("has no payment, billing or subscription code or route in the source", () => {
    const code = files.filter(
      (file) =>
        /\.(ts|tsx|js|mjs|cjs|swift|json)$/.test(file) &&
        !file.includes("package-lock") &&
        !file.endsWith("no-payments.test.ts"),
    );
    expect(code.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const file of code) {
      const text = readFileSync(root + file, "utf8");
      const match = PAYMENT_WORDS.exec(text);
      if (match) hits.push(`${file}: ${match[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it("does catch what it looks for", () => {
    for (const sample of [
      "import Stripe from 'stripe'",
      "const paymentMethod = 1",
      "POST /billing",
      "card number",
      "StoreKit",
    ])
      expect(PAYMENT_WORDS.test(sample), sample).toBe(true);
    expect(PAYMENT_LIBRARIES.test("stripe")).toBe(true);
    expect(PAYMENT_LIBRARIES.test("@stripe/stripe-js")).toBe(true);
    expect(PAYMENT_LIBRARIES.test("zod")).toBe(false);
  });
});
