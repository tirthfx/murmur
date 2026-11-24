import type { TeamClientResult } from "./team-client";

/**
 * Shared Skills and shared folders, as a team backend returns them (NT-16, NT-17). This extends
 * the team client without changing it: `teamClient.v1` is frozen, so what came after it is its
 * own interface, `teamContent.v1`, which a backend implements next to `TeamClient`. A backend
 * that does not (an older one) simply has no shared Skills or folders.
 *
 * Folders hold copies of notes a person chose to share, as text. Audio never goes through here.
 */
export const TEAM_CONTENT_VERSION = "teamContent.v1";

/** A Skill a team published: the Skill file as text, read-only for members. */
export interface SharedSkill {
  id: string;
  name: string;
  description: string;
  /** The Skill file: front matter, then the prompt. */
  body: string;
  scope: "company" | "department";
  departmentId: string | null;
  version: number;
  updatedAt: number;
}

export interface SharedSkillVersion {
  version: number;
  name: string;
  body: string;
  changedAt: number;
  changedBy: string;
}

export type SharedFolderKind = "shared" | "department" | "company";

export interface SharedFolder {
  id: string;
  name: string;
  kind: SharedFolderKind;
  departmentId: string | null;
  createdBy: string | null;
  /** The person made it. */
  mine: boolean;
  /** The person may add notes. */
  canWrite: boolean;
  /** The person may rename it, change who is in it, or remove it. */
  canManage: boolean;
  members: { userId: string; name: string; canWrite: boolean }[];
  /** The notes in it, without their text (read one at a time). */
  items: { id: string; title: string; sharedBy: string; sharedAt: number; sourceRef: string }[];
}

/** One shared note, with its text. */
export interface SharedNote {
  id: string;
  title: string;
  body: string;
  sourceRef: string;
  sharedBy: string;
  sharedAt: number;
}

/** What a client keeps in step with: the news that nothing moved, or the Skills and folders. */
export type TeamContentAnswer =
  | { unchanged: true; revision: number }
  | { unchanged: false; revision: number; skills: SharedSkill[]; folders: SharedFolder[] };

/** A person in a team, as a folder's member list needs to name them. */
export interface TeamPerson {
  userId: string;
  name: string;
  email: string;
  role: string;
}

export interface TeamContentClient {
  readonly contentVersion: typeof TEAM_CONTENT_VERSION;

  /** The people in a team, to choose who is in a shared folder. */
  people(teamId: string): Promise<TeamClientResult<TeamPerson[]>>;

  /** Pass the revision last seen to get `unchanged` when nothing moved. */
  content(teamId: string, since?: number): Promise<TeamClientResult<TeamContentAnswer>>;

  publishSkill(
    teamId: string,
    input: {
      name: string;
      description: string;
      body: string;
      scope?: "company" | "department";
      departmentId?: string;
    },
  ): Promise<TeamClientResult<SharedSkill>>;
  updateSkill(
    teamId: string,
    skillId: string,
    patch: { name?: string; description?: string; body?: string },
  ): Promise<TeamClientResult<{ skill: SharedSkill; changed: boolean }>>;
  removeSkill(teamId: string, skillId: string): Promise<TeamClientResult<null>>;
  skillVersions(teamId: string, skillId: string): Promise<TeamClientResult<SharedSkillVersion[]>>;

  createFolder(
    teamId: string,
    input: { name: string; kind: SharedFolderKind; departmentId?: string; members?: string[] },
  ): Promise<TeamClientResult<SharedFolder>>;
  renameFolder(
    teamId: string,
    folderId: string,
    name: string,
  ): Promise<TeamClientResult<SharedFolder>>;
  removeFolder(teamId: string, folderId: string): Promise<TeamClientResult<null>>;
  setFolderMember(
    teamId: string,
    folderId: string,
    userId: string,
    canWrite: boolean,
  ): Promise<TeamClientResult<SharedFolder>>;
  removeFolderMember(
    teamId: string,
    folderId: string,
    userId: string,
  ): Promise<TeamClientResult<null>>;

  shareNote(
    teamId: string,
    folderId: string,
    input: { title: string; body: string; sourceRef?: string },
  ): Promise<TeamClientResult<{ id: string }>>;
  readNote(teamId: string, folderId: string, noteId: string): Promise<TeamClientResult<SharedNote>>;
  removeNote(teamId: string, folderId: string, noteId: string): Promise<TeamClientResult<null>>;
}
