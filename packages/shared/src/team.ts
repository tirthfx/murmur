import { z } from "zod";
import type { SharedFolder, SharedSkill } from "./team-content";

/**
 * Team mode in the app (TM-01 client, TM-06): the app signs in to a team server, keeps a session
 * in the Keychain, locks when the Mac has been idle, and pulls the team's shared dictionary and
 * snippets. Nothing about it is on until the owner turns it on and connects to a server.
 */
export const TEAM_LIMITS = {
  idleLockMinutes: { min: 1, max: 240, default: 15 },
  /** How often the shared vocabulary is asked for when the server does not say. */
  syncMinutes: 5,
} as const;

export const TEAM_STATES = ["off", "signed_out", "locked", "signed_in"] as const;
export type TeamState = (typeof TEAM_STATES)[number];

export interface TeamSummary {
  id: string;
  name: string;
  myRole: string;
}

/** A proposal that was turned down, told to the person at their next sign-in. */
export interface TeamNotice {
  id: string;
  summary: string;
  note: string;
}

/** A Skill a team published, with the team it is from. */
export interface TeamSharedSkill extends SharedSkill {
  teamId: string;
  teamName: string;
}

/** A shared folder, with the team it is from. */
export interface TeamSharedFolder extends SharedFolder {
  teamId: string;
  teamName: string;
}

/** The result of an action on shared content: a value, or the words to show. */
export type TeamContentResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface TeamView {
  enabled: boolean;
  /** Which kind of backend the address is. */
  backend: "local" | "supabase";
  serverUrl: string;
  state: TeamState;
  /** Whether the server already has an owner: null until it has been asked. */
  serverSetUp: boolean | null;
  user: { name: string; email: string } | null;
  teams: TeamSummary[];
  idleLockMinutes: number;
  lastSyncAt: number | null;
  /** How the last sync went, in words, or "" when all is well. */
  syncProblem: string;
  /** The shared entries in use now. */
  sharedCounts: { dictionary: number; snippets: number };
  /** Proposals saved while the server was out of reach, waiting to be sent. */
  outbox: number;
  notices: TeamNotice[];
  /** The Skills and folders the teams share with this person. */
  shared: { skills: TeamSharedSkill[]; folders: TeamSharedFolder[] };
}

export type TeamResult =
  { ok: true; view: TeamView } | { ok: false; message: string; retryAfterSeconds?: number };

export type TeamRedeemResult =
  | { ok: true; status: "joined" | "pending"; teamName: string; view: TeamView }
  | { ok: false; message: string };

export const teamConnectSchema = z.strictObject({
  serverUrl: z.string().trim().min(1).max(300),
  /**
   * The public key of a Supabase project. With it the address is a Supabase project; without it
   * the address is a Murmur team server. The key is not a secret and gives no access alone.
   */
  projectKey: z.string().trim().max(500).optional(),
});
export const teamSetupSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});
export const teamSignInSchema = z.strictObject({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});
export const teamRedeemSchema = z.strictObject({
  code: z.string().trim().min(1).max(200),
  /** For someone with no account yet. */
  name: z.string().trim().max(100).optional(),
  email: z.string().trim().max(200).optional(),
  password: z.string().max(200).optional(),
});
/** An entry the person proposes to the team (TM-06, TM-07): the server decides if it goes live. */
export const teamProposeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("dictionary"),
    term: z.string().trim().min(1).max(100),
    replacement: z.string().max(1000).nullable(),
  }),
  z.strictObject({
    kind: z.literal("snippet"),
    trigger: z.string().trim().min(1).max(100),
    expansion: z.string().min(1).max(20000),
  }),
]);
export type TeamProposeInput = z.infer<typeof teamProposeSchema>;

const idField = z.string().min(1).max(64);
/** A shared folder for named people (NT-17). */
export const teamFolderCreateSchema = z.strictObject({
  teamId: idField,
  name: z.string().trim().min(1).max(100),
  members: z.array(idField).max(200),
});
export const teamNoteReadSchema = z.strictObject({
  teamId: idField,
  folderId: idField,
  noteId: idField,
});
/** Copy a team's Skill into the person's own Skills. */
export const teamSkillAddSchema = z.strictObject({ teamId: idField, skillId: idField });
/** Share a meeting's summary and tasks into a team folder. */
export const teamShareMeetingSchema = z.strictObject({
  meetingId: idField,
  teamId: idField,
  folderId: idField,
});
/** Changing the person's own password: the backend says if the new one is acceptable. */
export const teamPasswordChangeSchema = z.strictObject({
  current: z.string().min(1).max(200),
  next: z.string().min(1).max(200),
});
export type TeamPasswordChangeInput = z.infer<typeof teamPasswordChangeSchema>;
export type TeamFolderCreateInput = z.infer<typeof teamFolderCreateSchema>;
export type TeamNoteReadInput = z.infer<typeof teamNoteReadSchema>;
export type TeamSkillAddInput = z.infer<typeof teamSkillAddSchema>;
export type TeamShareMeetingInput = z.infer<typeof teamShareMeetingSchema>;
export type TeamProposeResult =
  | { ok: true; status: "live" | "pending" | "queued"; teamName: string }
  | { ok: false; message: string };
export type TeamConnectInput = z.infer<typeof teamConnectSchema>;
export type TeamSetupInput = z.infer<typeof teamSetupSchema>;
export type TeamSignInInput = z.infer<typeof teamSignInSchema>;
export type TeamRedeemInput = z.infer<typeof teamRedeemSchema>;

export const TEAM_MESSAGES = {
  locked: "Murmur is locked. Enter your password to continue.",
  unreachable: "Could not reach the team server.",
  sessionEnded: "Your team session ended. Sign in again.",
  wrongPassword: "The email or the password is not right.",
  strictLocal:
    "Strict local mode is on, so Murmur will not connect to a team server on the network.",
} as const;

/** Channels that show meetings, notes, questions or tasks: refused while Murmur is locked. */
const LOCKED_PREFIXES = ["meetings:", "ask:", "brief:", "tasks:"] as const;
/** What still works while locked, so a recording in progress can be stopped. */
const STILL_OPEN = new Set(["meetings:start", "meetings:stop"]);

export function isLockedChannel(channel: string): boolean {
  return !STILL_OPEN.has(channel) && LOCKED_PREFIXES.some((prefix) => channel.startsWith(prefix));
}
