import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CheckCommand,
  ProjectTestSettings,
  WorkflowTestSummary,
} from "./workflow-helper-api";

/**
 * Example curated Flutter test entrypoint.
 *
 * Copy this file to `.pi/project-test-settings.ts` and change this path to the
 * test target your project wants to run after each edit. Common choices are:
 *
 * - `test/all_tests.dart` for a manually curated suite,
 * - `test/widget_test.dart` for a small starter project,
 * - `test` to run the complete Flutter test directory.
 */
const FLUTTER_TEST_TARGET = "test/all_tests.dart";

/** Validation commands for a generic Flutter/Dart project. */
const CHECK_COMMANDS: CheckCommand[] = [
  {
    label: "dart format --set-exit-if-changed .",
    command: "dart",
    args: ["format", "--set-exit-if-changed", "."],
    timeout: 120_000,
  },
  {
    label: `flutter test ${FLUTTER_TEST_TARGET}`,
    command: "flutter",
    args: ["test", "--reporter", "json", FLUTTER_TEST_TARGET],
    timeout: 600_000,
    kind: "flutterTest",
  },
  {
    label: "dart analyze",
    command: "dart",
    args: ["analyze"],
    timeout: 180_000,
  },
];

/** Detects whether the current working directory looks like a Flutter project root. */
function isProjectRepository(cwd: string): boolean {
  const pubspecPath = join(cwd, "pubspec.yaml");
  const testTargetPath = join(cwd, FLUTTER_TEST_TARGET);

  return existsSync(pubspecPath) && existsSync(testTargetPath);
}

/** Parses Flutter's machine-readable test output into stable counters. */
function parseFlutterTestJson(stdout: string): WorkflowTestSummary {
  const summary: WorkflowTestSummary = {
    passed: 0,
    failed: 0,
    skipped: 0,
    total: 0,
  };

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line) as {
        type?: string;
        hidden?: boolean;
        skipped?: boolean;
        result?: string;
      };

      if (event.type !== "testDone" || event.hidden) {
        continue;
      }

      summary.total += 1;
      if (event.skipped) {
        summary.skipped += 1;
      } else if (event.result === "success") {
        summary.passed += 1;
      } else {
        summary.failed += 1;
      }
    } catch {
      // Flutter can occasionally print non-JSON lines around reporter output.
      // Ignore those lines and keep parsing later machine-readable events.
    }
  }

  return summary;
}

/** Formats a compact human-readable summary from parsed Flutter test counters. */
function formatFlutterTestSummary(summary: WorkflowTestSummary): string {
  return `${summary.passed} of ${summary.total} tests passed (${summary.failed} failed, ${summary.skipped} skipped)`;
}

/** Extracts a compact human-readable summary from Flutter's JSON reporter. */
function summarizeFlutterTestJson(
  stdout: string,
  stderr: string,
  ok: boolean,
  formatCommandOutput: (stdout: string, stderr: string) => string,
): string {
  if (ok) {
    return formatFlutterTestSummary(parseFlutterTestJson(stdout));
  }

  return formatCommandOutput(stdout, stderr);
}

/** Throws when a self-test expectation is not met. */
function expectEqual<T>(name: string, actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Runs fast unit tests for the example Flutter parsing behavior. */
function runSelfTests(): string {
  const successfulJson = [
    JSON.stringify({ type: "testDone", hidden: true, skipped: false, result: "success" }),
    JSON.stringify({ type: "testDone", hidden: false, skipped: false, result: "success" }),
    JSON.stringify({ type: "testDone", hidden: false, skipped: true, result: "success" }),
    "not json, ignored for successful test summaries",
  ].join("\n");

  expectEqual(
    "successful Flutter JSON summary",
    summarizeFlutterTestJson(successfulJson, "", true, (stdout, stderr) => [stdout, stderr].filter(Boolean).join("\n")),
    "1 of 2 tests passed (0 failed, 1 skipped)",
  );

  expectEqual(
    "failed Flutter JSON falls back to raw output",
    summarizeFlutterTestJson("failure details", "stack trace", false, (stdout, stderr) =>
      [stdout, stderr].filter(Boolean).join("\n"),
    ),
    "failure details\nstack trace",
  );

  expectEqual(
    "skipped-only tests have no passed tests",
    parseFlutterTestJson(
      JSON.stringify({ type: "testDone", hidden: false, skipped: true, result: "success" }),
    ).passed,
    0,
  );

  return "Flutter project test settings self-tests passed (3 assertions).";
}

/** Project-specific test settings consumed by the generic workflow extension. */
const projectTestSettings: ProjectTestSettings = {
  checkCommands: CHECK_COMMANDS,
  isProjectRepository,
  evaluateCheck: ({ check, stdout, stderr, ok, formatCommandOutput }) => {
    if (check.kind !== "flutterTest") {
      return { output: formatCommandOutput(stdout, stderr) };
    }

    const testSummary = parseFlutterTestJson(stdout);
    const allTestsPassed =
      ok &&
      testSummary.passed > 0 &&
      testSummary.failed === 0 &&
      testSummary.passed + testSummary.skipped === testSummary.total;

    return {
      output: summarizeFlutterTestJson(stdout, stderr, ok, formatCommandOutput),
      testSummary,
      continueChecks: allTestsPassed,
      stopReason: allTestsPassed
        ? undefined
        : "Skipping dart analyze because the Flutter tests did not pass any non-skipped tests.",
    };
  },
  runSelfTests,
};

export default projectTestSettings;
