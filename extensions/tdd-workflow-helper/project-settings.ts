import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProjectTestSettings } from "./types";
import { DEFAULT_PROJECT_TEST_SETTINGS_PATH } from "./types";

/** Loads project-specific settings from the current project's `.pi` directory. */
export async function loadProjectTestSettings(cwd: string): Promise<ProjectTestSettings | undefined> {
  const settingsPath = resolve(cwd, DEFAULT_PROJECT_TEST_SETTINGS_PATH);
  if (!existsSync(settingsPath)) {
    return undefined;
  }

  // Include the modification timestamp in the module URL so edits to project
  // settings are picked up without requiring a pi process restart.
  const settingsUrl = pathToFileURL(settingsPath);
  settingsUrl.searchParams.set("mtime", String(statSync(settingsPath).mtimeMs));
  const module = (await import(settingsUrl.href)) as { default?: ProjectTestSettings };
  return module.default;
}
