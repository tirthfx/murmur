import { z } from "zod";

// Developer features (PZ-26, PZ-27): jargon packs the owner can turn on or off. The pack
// terms are plain JSON files in main; this is what the Hub and settings need to know.

export const JARGON_PACKS = [
  {
    id: "git",
    label: "Git and GitHub",
    example: "rebase, cherry-pick, GitHub Actions",
    defaultOn: true,
  },
  {
    id: "packages",
    label: "Package managers",
    example: "npm, pnpm, Homebrew, pip",
    defaultOn: true,
  },
  { id: "web", label: "Web", example: "TypeScript, Next.js, JSX", defaultOn: true },
  {
    id: "cloud",
    label: "Cloud CLIs and tools",
    example: "kubectl, Terraform, gcloud",
    defaultOn: false,
  },
  {
    id: "databases",
    label: "Databases",
    example: "PostgreSQL, SQLite, Redis",
    defaultOn: false,
  },
] as const;
export type JargonPackId = (typeof JARGON_PACKS)[number]["id"];

export const JARGON_LIMITS = {
  /** Terms per pack file (PZ-27). */
  termsPerPack: 500,
} as const;

export const jargonPacksSchema = z.strictObject({
  git: z.boolean(),
  packages: z.boolean(),
  web: z.boolean(),
  cloud: z.boolean(),
  databases: z.boolean(),
});
export type JargonPacks = z.infer<typeof jargonPacksSchema>;

export const DEFAULT_JARGON_PACKS: JargonPacks = Object.fromEntries(
  JARGON_PACKS.map((pack) => [pack.id, pack.defaultOn]),
) as JargonPacks;
