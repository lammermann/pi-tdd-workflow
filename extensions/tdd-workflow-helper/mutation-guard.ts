import { isAbsolute, relative, resolve } from "node:path";

/** Escapes a literal string for use inside a regular expression. */
function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/** Returns whether a project-relative path matches a small glob subset: `*` and `**`. */
function matchesGuardedPathPattern(relativePath: string, pattern: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  const expression = normalizedPattern
    .split("**")
    .map((part) => escapeRegex(part).replace(/\*/g, "[^/]*"))
    .join(".*");

  return new RegExp(`^${expression}$`).test(relativePath);
}

/** Returns whether a resolved path points outside the current project directory. */
function isOutsideProjectDirectory(cwd: string, absolutePath: string): boolean {
  const relativePath = relative(cwd, absolutePath);
  return relativePath === "" ? false : relativePath.startsWith("..") || isAbsolute(relativePath);
}

/** Returns a normalized project-relative path for a resolved path. */
function projectRelativePath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).replace(/\\/g, "/");
}

/** Returns whether a resolved path points into a guarded top-level test directory. */
function isInGuardedTestDirectory(cwd: string, absolutePath: string): boolean {
  const relativePath = projectRelativePath(cwd, absolutePath);
  return (
    relativePath === "test" ||
    relativePath.startsWith("test/") ||
    relativePath === "tests" ||
    relativePath.startsWith("tests/")
  );
}

/** Returns whether a resolved path is the project-local workflow settings file. */
function isProjectTestSettingsFile(cwd: string, absolutePath: string): boolean {
  return projectRelativePath(cwd, absolutePath) === ".pi/project-test-settings.ts";
}

/** Extracts and resolves the target file path from built-in edit/write tool input. */
export function resolveMutationTargetPath(cwd: string, input: unknown): string | undefined {
  if (input === null || typeof input !== "object" || !("path" in input)) {
    return undefined;
  }

  const rawPath = (input as { path?: unknown }).path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    return undefined;
  }

  return resolve(cwd, rawPath.startsWith("@") ? rawPath.slice(1) : rawPath);
}

/** Builds the confirmation message required before guarded mutations. */
export function mutationGuardReason(
  cwd: string,
  absolutePath: string,
  configuredGuardedPaths: string[] = [],
): string | undefined {
  if (isOutsideProjectDirectory(cwd, absolutePath)) {
    return `modify file outside the project directory: ${absolutePath}`;
  }
  if (isInGuardedTestDirectory(cwd, absolutePath)) {
    return `modify guarded test file: ${relative(cwd, absolutePath)}`;
  }
  if (isProjectTestSettingsFile(cwd, absolutePath)) {
    return "modify guarded project test settings file: .pi/project-test-settings.ts";
  }

  const relativePath = projectRelativePath(cwd, absolutePath);
  if (configuredGuardedPaths.some((pattern) => matchesGuardedPathPattern(relativePath, pattern))) {
    return `modify configured guarded file: ${relativePath}`;
  }

  return undefined;
}
