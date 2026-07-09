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
  /** Additional project-relative glob patterns that require user confirmation before edits. */
  guardedPaths?: string[];
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
