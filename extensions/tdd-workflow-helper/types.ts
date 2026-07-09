/** Tool names that mutate repository files through pi's built-in tools. */
export const MUTATION_TOOLS = new Set(["edit", "write"]);

/** Tools disabled while the workflow is active. */
export const DEFAULT_WORKFLOW_DISABLED_TOOLS = ["bash"];

/** Default project-relative location for workflow validation settings. */
export const DEFAULT_PROJECT_TEST_SETTINGS_PATH = ".pi/project-test-settings.ts";

/** User-facing actions supported by the workflow toggle command. */
export type WorkflowToggleAction = "on" | "off" | "status";

/** User-facing actions supported by the workflow tool policy command. */
export type WorkflowToolAction = "disable" | "enable" | "status";

/**
 * Structural mirror of `.pi/workflow-helper-api.ts` used for dynamic settings.
 *
 * The extension intentionally does not import that project-local file statically:
 * this extension may be installed outside the project, for example in
 * `~/.pi/extensions`, while `.pi/workflow-helper-api.ts` belongs to the active
 * project. TypeScript types cannot be passed through dynamic imports at runtime,
 * so the extension keeps this compatible structural copy for its own checks.
 *
 * TODO(shared package): Move these exported types and the project-local
 * `.pi/workflow-helper-api.ts` types into a shared package such as
 * `@your-org/pi-workflow-helper-api`. Then import the package from both this
 * extension and each project's `.pi/project-test-settings.ts`. Once all users can
 * resolve that package from their extension installation location, remove this
 * structural mirror.
 */

/** Validation command executed after each successful file mutation. */
export type CheckCommand = {
  label: string;
  command: string;
  args: string[];
  timeout: number;
  /** Optional project-defined metadata used by external settings. */
  kind?: string;
};

/** Generic test result counters consumed by the workflow automation. */
export type WorkflowTestSummary = {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
};

/** Result returned by project settings after a workflow command finishes. */
export type CheckEvaluation = {
  output: string;
  testSummary?: WorkflowTestSummary;
  continueChecks?: boolean;
  stopReason?: string;
};

/** Project-specific test and validation behavior loaded from `.pi/project-test-settings.ts`. */
export type ProjectTestSettings = {
  checkCommands: CheckCommand[];
  isProjectRepository(cwd: string): boolean;
  evaluateCheck(args: {
    check: CheckCommand;
    stdout: string;
    stderr: string;
    ok: boolean;
    formatCommandOutput(stdout: string, stderr: string): string;
  }): CheckEvaluation;
  runSelfTests?(): string;
};
