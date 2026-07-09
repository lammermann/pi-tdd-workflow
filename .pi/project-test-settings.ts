import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CheckCommand,
  ProjectTestSettings,
  WorkflowTestSummary,
} from "./workflow-helper-api";

const HELPER_SELF_TEST_SUMMARY: WorkflowTestSummary = {
  passed: 1,
  failed: 0,
  skipped: 0,
  total: 1,
};

const CHECK_COMMANDS: CheckCommand[] = [
  {
    label: "conflict marker check",
    command: "sh",
    args: [
      "-c",
      "! grep -R --exclude-dir=.git --exclude-dir=.jj --exclude-dir=.pi -n -E '^(<<<<<<<|=======|>>>>>>>)' .",
    ],
    timeout: 30_000,
  },
  {
    label: "tdd-workflow-helper self-tests",
    command: "pi",
    args: [
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-tools",
      "--extension",
      "./extensions/tdd-workflow-helper/index.ts",
      "--print",
      "--approve",
      "--offline",
      "/tdd-workflow-helper-test",
    ],
    timeout: 120_000,
    kind: "selfTest",
  },
];

function isProjectRepository(cwd: string): boolean {
  return (
    existsSync(join(cwd, "package.json")) &&
    existsSync(join(cwd, "extensions", "tdd-workflow-helper", "index.ts")) &&
    existsSync(join(cwd, "skills", "tdd-workflow", "SKILL.md"))
  );
}

function evaluateCheck({
  check,
  stdout,
  stderr,
  ok,
  formatCommandOutput,
}: Parameters<ProjectTestSettings["evaluateCheck"]>[0]) {
  if (check.kind === "selfTest") {
    return {
      output: ok
        ? "TDD workflow helper self-tests passed."
        : formatCommandOutput(stdout, stderr),
      testSummary: ok
        ? HELPER_SELF_TEST_SUMMARY
        : { ...HELPER_SELF_TEST_SUMMARY, passed: 0, failed: 1 },
      continueChecks: ok,
      stopReason: ok ? undefined : "Stopping because the helper self-tests failed.",
    };
  }

  return {
    output: ok ? "No conflict markers found." : formatCommandOutput(stdout, stderr),
    continueChecks: ok,
    stopReason: ok ? undefined : "Stopping because conflict markers were found.",
  };
}

function expectEqual<T>(name: string, actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function runSelfTests(): string {
  expectEqual("repository detector accepts this repo", isProjectRepository(process.cwd()), true);
  expectEqual(
    "self-test success output",
    evaluateCheck({
      check: CHECK_COMMANDS[1],
      stdout: "",
      stderr: "",
      ok: true,
      formatCommandOutput: (stdout, stderr) => [stdout, stderr].filter(Boolean).join("\n"),
    }).output,
    "TDD workflow helper self-tests passed.",
  );
  expectEqual(
    "conflict marker check continues on success",
    evaluateCheck({
      check: CHECK_COMMANDS[0],
      stdout: "",
      stderr: "",
      ok: true,
      formatCommandOutput: (stdout, stderr) => [stdout, stderr].filter(Boolean).join("\n"),
    }).continueChecks,
    true,
  );

  return "Project test settings self-tests passed (3 assertions).";
}

const projectTestSettings: ProjectTestSettings = {
  checkCommands: CHECK_COMMANDS,
  guardedPaths: ["extensions/**/tests/**"],
  isProjectRepository,
  evaluateCheck,
  runSelfTests,
};

export default projectTestSettings;
