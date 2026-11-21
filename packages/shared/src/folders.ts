import { z } from "zod";

/**
 * Folders for meetings (NT-17) and shareable files (NT-18). A meeting is in one folder or in the
 * Inbox, which is not a folder row: a meeting with no folder is in the Inbox, so deleting a
 * folder never deletes its meetings.
 */

export const INBOX = "inbox";
export const FOLDER_NAME_MAX = 60;

export interface MeetingFolder {
  id: string;
  name: string;
  /** How many meetings are in it. */
  meetings: number;
  /** The Skill that writes the summaries of its meetings; null uses the one in Settings. */
  defaultSkillId: string | null;
  /** Where a file is written after each of its meetings is ready; null for nowhere. */
  autoExportPath: string | null;
}

export type FolderResult =
  { ok: true; folders: MeetingFolder[]; id?: string } | { ok: false; message: string };

/** A folder a meeting looks like it belongs in. Offered, never applied without a click. */
export interface FolderSuggestion {
  folderId: string;
  folderName: string;
}

export const folderPatchSchema = z.strictObject({
  defaultSkillId: z.string().min(1).max(64).nullable(),
});
export type FolderPatch = z.infer<typeof folderPatchSchema>;

/** What a shareable file holds (NT-18). Audio is never in it. */
export const meetingExportOptionsSchema = z.strictObject({
  summary: z.boolean(),
  transcript: z.boolean(),
  tasks: z.boolean(),
  notes: z.boolean(),
});
export type MeetingExportOptions = z.infer<typeof meetingExportOptionsSchema>;
export const DEFAULT_EXPORT_OPTIONS: MeetingExportOptions = {
  summary: true,
  transcript: true,
  tasks: true,
  notes: false,
};

export type MeetingExportResult =
  { ok: true; path: string } | { ok: false; message: string } | { ok: false; cancelled: true };

/** `notetaker.folders` (NT-17). */
export const foldersSettingsSchema = z.strictObject({
  /** Offer a folder for a meeting in the Inbox, from its title and where earlier ones went. */
  suggest: z.boolean(),
  /** Where a new meeting goes: "inbox" or the id of a folder. */
  defaultFolder: z.string().min(1).max(64),
});
export const DEFAULT_FOLDERS_SETTINGS: z.infer<typeof foldersSettingsSchema> = {
  suggest: true,
  defaultFolder: INBOX,
};
