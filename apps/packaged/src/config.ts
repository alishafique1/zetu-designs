import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

export const PACKAGED_CONFIG_FILE_NAME = "open-design-packaged.json";
export const PACKAGED_CONFIG_PATH_ENV = "OD_PACKAGED_CONFIG_PATH";

export type PackagedConfig = {
  dataRoot?: string;
  logsRoot?: string;
  namespace: string;
  sidecarBase?: string;
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePackagedConfigPath(): Promise<string> {
  const explicitPath = process.env[PACKAGED_CONFIG_PATH_ENV];
  if (explicitPath != null && explicitPath.length > 0) return explicitPath;

  const appPathConfig = join(app.getAppPath(), PACKAGED_CONFIG_FILE_NAME);
  if (await pathExists(appPathConfig)) return appPathConfig;

  return join(process.resourcesPath, PACKAGED_CONFIG_FILE_NAME);
}

export async function readPackagedConfig(): Promise<PackagedConfig> {
  const configPath = await resolvePackagedConfigPath();
  const config = JSON.parse(await readFile(configPath, "utf8")) as PackagedConfig;

  if (typeof config.namespace !== "string" || config.namespace.length === 0) {
    throw new Error(`packaged config is missing namespace: ${configPath}`);
  }

  return config;
}
