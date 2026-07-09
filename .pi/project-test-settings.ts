import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CheckCommand,
  ProjectTestSettings,
  WorkflowTestSummary,
} from "./workflow-helper-api";

const ASSERTION_COUNT_PATTERN = /passed \((\d+) assertions?\)/g;

function workflowTestSummary(passed: number, failed = 0, msg = ""): WorkflowTestSummary {
  return { passed, failed, skipped: 0, total: passed + failed, msg };
}

function helperSelfTestSummary(stdout: string, stderr: string, ok: boolean): WorkflowTestSummary {
  const output = [stdout, stderr].filter(Boolean).join("\n");
  const assertionLines = new Set(
    output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.match(ASSERTION_COUNT_PATTERN) !== null),
  );
  const passed = [...assertionLines].reduce((total, line) => {
    ASSERTION_COUNT_PATTERN.lastIndex = 0;
    return total + [...line.matchAll(ASSERTION_COUNT_PATTERN)].reduce(
      (lineTotal, match) => lineTotal + Number(match[1]),
      0,
    );
  }, 0);

  if (!ok) {
    return workflowTestSummary(passed, 1, "self-test command failed");
  }

  return passed > 0
    ? workflowTestSummary(passed)
    : workflowTestSummary(0, 1, "self-test command passed, but no assertion count was found in its output");
}

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
    const testSummary = helperSelfTestSummary(stdout, stderr, ok);
    const summaryMessage = testSummary.msg === undefined || testSummary.msg === "" ? "" : `\n${testSummary.msg}`;
    const continueChecks = ok && testSummary.failed === 0;
    return {
      output: ok
        ? `TDD workflow helper self-tests passed.${summaryMessage}`
        : formatCommandOutput(stdout, stderr),
      testSummary,
      continueChecks,
      stopReason: continueChecks ? undefined : "Stopping because the helper self-tests failed or its output could not be parsed.",
    };
  }

  return {
    output: ok ? "No conflict markers found." : formatCommandOutput(stdout, stderr),
    continueChecks: ok,
    stopReason: ok ? undefined : "Stopping because conflict markers were found.",
  };
}

function createExpectEqual(): [<T>(name: string, actual: T, expected: T) => void, () => number] {
  let assertionCount = 0;
  return [
    <T>(name: string, actual: T, expected: T): void => {
      assertionCount += 1;
      if (actual !== expected) {
        throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    () => assertionCount,
  ];
}

function runSelfTests(): string {
  const [expectEqual, assertionCount] = createExpectEqual();
  expectEqual("repository detector accepts this repo", isProjectRepository(process.cwd()), true);
  expectEqual(
    "self-test success output",
    evaluateCheck({
      check: CHECK_COMMANDS[1],
      stdout: "TDD workflow helper self-tests passed (18 assertions).\nProject test settings self-tests passed (4 assertions).",
      stderr: "",
      ok: true,
      formatCommandOutput: (stdout, stderr) => [stdout, stderr].filter(Boolean).join("\n"),
    }).output,
    "TDD workflow helper self-tests passed.",
  );
  expectEqual(
    "self-test summary parses assertion counts",
    evaluateCheck({
      check: CHECK_COMMANDS[1],
      stdout: "TDD workflow helper self-tests passed (18 assertions).\nProject test settings self-tests passed (3 assertions).",
      stderr: "",
      ok: true,
      formatCommandOutput: (stdout, stderr) => [stdout, stderr].filter(Boolean).join("\n"),
    }).testSummary?.passed,
    21,
  );
  const parseErrorEvaluation = evaluateCheck({
    check: CHECK_COMMANDS[1],
    stdout: "",
    stderr: "",
    ok: true,
    formatCommandOutput: (stdout, stderr) => [stdout, stderr].filter(Boolean).join("\n"),
  });
  expectEqual(
    "self-test summary reports parse errors without assertion counts",
    parseErrorEvaluation.testSummary?.msg,
    "self-test command passed, but no assertion count was found in its output",
  );
  expectEqual("self-test parse error stops checks", parseErrorEvaluation.continueChecks, false);
  expectEqual(
    "self-test summary deduplicates stdout and stderr",
    evaluateCheck({
      check: CHECK_COMMANDS[1],
      stdout: "TDD workflow helper self-tests passed (18 assertions).\nProject test settings self-tests passed (4 assertions).",
      stderr: "TDD workflow helper self-tests passed (18 assertions).\nProject test settings self-tests passed (4 assertions).",
      ok: true,
      formatCommandOutput: (stdout, stderr) => [stdout, stderr].filter(Boolean).join("\n"),
    }).testSummary?.passed,
    22,
  );
  const failedWithCountsEvaluation = evaluateCheck({
    check: CHECK_COMMANDS[1],
    stdout: "TDD workflow helper self-tests passed (18 assertions).",
    stderr: "Error: project settings failed",
    ok: false,
    formatCommandOutput: (stdout, stderr) => [stdout, stderr].filter(Boolean).join("\n"),
  });
  expectEqual("self-test summary counts failed command", failedWithCountsEvaluation.testSummary?.failed, 1);
  expectEqual("self-test failed command includes partial pass count", failedWithCountsEvaluation.testSummary?.passed, 18);
  expectEqual("self-test failed command total includes failed command", failedWithCountsEvaluation.testSummary?.total, 19);
  expectEqual("self-test failed command stops checks", failedWithCountsEvaluation.continueChecks, false);

  const failedWithoutCountsEvaluation = evaluateCheck({
    check: CHECK_COMMANDS[1],
    stdout: "",
    stderr: "Error: project settings failed",
    ok: false,
    formatCommandOutput: (stdout, stderr) => [stdout, stderr].filter(Boolean).join("\n"),
  });
  expectEqual("self-test failed command without counts has no passed tests", failedWithoutCountsEvaluation.testSummary?.passed, 0);
  expectEqual("self-test failed command without counts records one failure", failedWithoutCountsEvaluation.testSummary?.failed, 1);
  expectEqual("self-test failed command without counts total includes failure", failedWithoutCountsEvaluation.testSummary?.total, 1);
  expectEqual("self-test failed command without counts explains failure", failedWithoutCountsEvaluation.testSummary?.msg, "self-test command failed");
  expectEqual("self-test failed command without counts stops checks", failedWithoutCountsEvaluation.continueChecks, false);
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

  return `Project test settings self-tests passed (${assertionCount()} assertions).`;
}

const projectTestSettings: ProjectTestSettings = {
  checkCommands: CHECK_COMMANDS,
  guardedPaths: ["extensions/**/tests/**"],
  isProjectRepository,
  evaluateCheck,
  runSelfTests,
};

export default projectTestSettings;
