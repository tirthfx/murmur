import path from "node:path";

export interface ProfilePaths {
  /** Parent of the `Murmur` data folder (database, saved audio). */
  appData: string;
  /** Electron's own folder (window state, the Bar position). */
  userData: string;
  /** Parent of the `Murmur/models` folder. */
  modelsAppData: string;
  /** True when `MURMUR_PROFILE_DIR` replaced the normal folders. */
  isOverridden: boolean;
}

/**
 * Where this run keeps its data. Normally the system folders. `MURMUR_PROFILE_DIR` points
 * everything at another folder, for a clean first run or a test, without touching the real
 * profile. Models are large, so `MURMUR_SHARE_MODELS=1` keeps reading them from the normal
 * place while the rest of the profile is separate.
 */
export function profilePaths(
  env: Record<string, string | undefined>,
  defaults: { appData: string; userData: string },
): ProfilePaths {
  const dir = env.MURMUR_PROFILE_DIR?.trim();
  if (!dir) return { ...defaults, modelsAppData: defaults.appData, isOverridden: false };
  const root = path.resolve(dir);
  return {
    appData: root,
    userData: path.join(root, "electron"),
    modelsAppData: env.MURMUR_SHARE_MODELS === "1" ? defaults.appData : root,
    isOverridden: true,
  };
}
