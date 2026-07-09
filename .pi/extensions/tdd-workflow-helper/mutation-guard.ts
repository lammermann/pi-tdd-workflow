import { isAbsolute, relative, resolve } from "node:path";

/** Returns whether a resolved path points outside the current project directory. */
function isOutsideProjectDirectory(cwd: string, absolutePath: string): boolean {
  const relativePath = relative(cwd, absolutePath);
  return relativePath === "" ? false : relativePath.startsWith("..") || isAbsolute(relativePath);
}

/** Returns whether a resolved path points into a guarded top-level test directory. */
function isInGuardedTestDirectory(cwd: string, absolutePath: string): boolean {
  const relativePath = relative(cwd, absolutePath).replace(/\\/g, "/");
  return (
    relativePath === "test" ||
    relativePath.startsWith("test/") ||
    relativePath === "tests" ||
    relativePath.startsWith("tests/")
  );
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
export function mutationGuardReason(cwd: string, absolutePath: string): string | undefined {
  if (isOutsideProjectDirectory(cwd, absolutePath)) {
    return `modify file outside the project directory: ${absolutePath}`;
  }
  if (isInGuardedTestDirectory(cwd, absolutePath)) {
    return `modify guarded test file: ${relative(cwd, absolutePath)}`;
  }

  return undefined;
}
