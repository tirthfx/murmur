import path from "node:path";

export interface ProfilePaths {
  /** Parent of the `Murmur` data folder (database, saved audio). */
  appData: string;
  /** Electron's own folder (window state, the Bar position). */
  userData: string;
  /** Parent of the `Murmur/models` folder. */
  modelsAppData: string;
  /** True when `MURMUR_PROFILE_DIR` or the sandbox replaced the normal folders. */
  isOverridden: boolean;
  /** HB-55: running on demo data in a folder of its own. */
  isSandbox: boolean;
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
  sandbox = false,
): ProfilePaths {
  const dir = env.MURMUR_PROFILE_DIR?.trim();
  const root = dir ? path.resolve(dir) : null;
  const own: ProfilePaths = root
    ? {
        appData: root,
        userData: path.join(root, "electron"),
        modelsAppData: env.MURMUR_SHARE_MODELS === "1" ? defaults.appData : root,
        isOverridden: true,
        isSandbox: false,
      }
    : { ...defaults, modelsAppData: defaults.appData, isOverridden: false, isSandbox: false };
  if (!sandbox) return own;
  // The sandbox keeps everything under this profile's own folder, and shares the models.
  const demo = sandboxDir(own.userData);
  return {
    appData: demo,
    userData: path.join(demo, "electron"),
    modelsAppData: own.modelsAppData,
    isOverridden: true,
    isSandbox: true,
  };
}

/** Where a profile's demo data is kept. */
export function sandboxDir(userData: string): string {
  return path.join(userData, "sandbox");
}
