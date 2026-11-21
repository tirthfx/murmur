import path from "node:path";
import type { Logger } from "../helper/types";
import type { FoldersStore } from "./folders-store";

export interface AutoExportDeps {
  folders: Pick<FoldersStore, "folderOf" | "get">;
  /** The file for a meeting: its name and its HTML; null when the meeting is gone. */
  build(meetingId: string): { fileName: string; html: string } | null;
  directoryExists(dir: string): boolean;
  write(file: string, text: string): void;
  logger: Logger;
}

/**
 * After each meeting of a folder is ready, a shareable file is written to the folder's chosen
 * path (NT-18): a synced folder is how a file reaches other people without a server. Writing
 * again replaces the file of the same meeting, so it follows the summary and the tasks. A path
 * that is gone, or a file that cannot be written, is logged and never stops the meeting.
 */
export function createAutoExport(deps: AutoExportDeps): { run(meetingId: string): string | null } {
  return {
    run(meetingId) {
      const folderId = deps.folders.folderOf(meetingId);
      const folder = folderId ? deps.folders.get(folderId) : null;
      const dir = folder?.autoExportPath;
      if (!folder || !dir) return null;
      try {
        if (!deps.directoryExists(dir)) {
          deps.logger.warn(`the export folder of "${folder.name}" is not there: ${dir}`);
          return null;
        }
        const file = deps.build(meetingId);
        if (!file) return null;
        const target = path.join(dir, file.fileName);
        deps.write(target, file.html);
        return target;
      } catch (error) {
        deps.logger.warn(
          `exporting meeting ${meetingId} failed: ${error instanceof Error ? error.message : error}`,
        );
        return null;
      }
    },
  };
}
