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

// File tags, variable recognition and coding CLI detection (PZ-24, PZ-25, PZ-28): all off by
// default.

/** Coding assistants that run in a terminal (PZ-28), lower case, editable in the Hub. */
export const DEFAULT_CODING_CLIS = [
  "claude",
  "codex",
  "gemini",
  "aider",
  "cursor-agent",
  "opencode",
  "goose",
  "amp",
  "crush",
  "qwen",
] as const;

export const CODING_CLI_NAME = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export const developerToolsSchema = z.strictObject({
  /** "at" plus a file name inserts @path in AI editors (PZ-24). */
  fileTags: z.boolean(),
  /** Where workspaces are looked up by the folder name in an editor's title. */
  codeFolders: z.array(z.string().min(1).max(1024)).max(10),
  /** Identifiers on screen replace matching spoken words (PZ-25). */
  variables: z.boolean(),
  /** A coding CLI running in the terminal in front makes it a Developer app (PZ-28). */
  cliDetection: z.boolean(),
  cliNames: z.array(z.string().regex(CODING_CLI_NAME)).max(50),
});
export type DeveloperTools = z.infer<typeof developerToolsSchema>;

export const DEFAULT_DEVELOPER_TOOLS: DeveloperTools = {
  fileTags: false,
  codeFolders: [],
  variables: false,
  cliDetection: false,
  cliNames: [...DEFAULT_CODING_CLIS],
};
