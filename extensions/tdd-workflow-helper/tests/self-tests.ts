import { buildWorkflowCheckFeedback, formatWorkflowCheckSummary } from "../checks";
import {
  formatDisabledWorkflowTools,
  parseWorkflowToggleAction,
  parseWorkflowToolCommand,
} from "../commands";
import { mutationGuardReason } from "../mutation-guard";
import { loadProjectTestSettings } from "../project-settings";

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

/** Runs fast unit tests for the extension's pure formatting/parsing logic. */
export async function runSelfTests(cwd: string): Promise<string> {
  const [expectEqual, assertionCount] = createExpectEqual();
  expectEqual("toggle parses enable alias", parseWorkflowToggleAction("enable"), "on");
  expectEqual("toggle parses deactivate alias", parseWorkflowToggleAction("deactivate"), "off");
  expectEqual("toggle rejects unknown action", parseWorkflowToggleAction("maybe"), undefined);
  expectEqual("tool policy parses disable", parseWorkflowToolCommand("disable bash")?.action, "disable");
  expectEqual("tool policy parses enable tool", parseWorkflowToolCommand("allow bash")?.tool, "bash");
  expectEqual("tool policy formats empty list", formatDisabledWorkflowTools(new Set()), "none");
  expectEqual("project path guard allows lib file", mutationGuardReason("/repo", "/repo/lib/main.dart"), undefined);
  expectEqual(
    "project path guard catches outside file",
    mutationGuardReason("/repo", "/tmp/file.txt"),
    "modify file outside the project directory: /tmp/file.txt",
  );
  expectEqual(
    "project path guard catches test file",
    mutationGuardReason("/repo", "/repo/test/foo_test.dart"),
    "modify guarded test file: test/foo_test.dart",
  );
  expectEqual(
    "project path guard catches project test settings",
    mutationGuardReason("/repo", "/repo/.pi/project-test-settings.ts"),
    "modify guarded project test settings file: .pi/project-test-settings.ts",
  );
  expectEqual(
    "project path guard does not catch nested extension tests by default",
    mutationGuardReason("/repo", "/repo/extensions/helper/tests/self-tests.ts"),
    undefined,
  );
  expectEqual(
    "project path guard catches configured extension tests",
    mutationGuardReason("/repo", "/repo/extensions/helper/tests/self-tests.ts", ["extensions/**/tests/**"]),
    "modify configured guarded file: extensions/helper/tests/self-tests.ts",
  );

  const feedback = buildWorkflowCheckFeedback({
    label: "example check",
    ok: true,
    code: 0,
    killed: false,
    evaluatedOutput: "filtered output",
    commandOutput: "full output",
  });
  expectEqual("workflow check LLM feedback is filtered", feedback.llmSection.includes("filtered output"), true);
  expectEqual("workflow check LLM feedback hides full output", feedback.llmSection.includes("full output"), false);
  expectEqual("workflow check user feedback includes summary label", feedback.userSection.includes("Summary"), true);
  expectEqual("workflow check user feedback includes test function output label", feedback.userSection.includes("Test function output"), true);
  expectEqual("workflow check user feedback is full", feedback.userSection.includes("full output"), true);
  expectEqual(
    "workflow check summary formats test counts",
    formatWorkflowCheckSummary({ passed: 1, failed: 0, skipped: 0, total: 1 }, false),
    "Tests: 1 passed, 0 failed, 0 skipped",
  );

  const projectTestSettings = await loadProjectTestSettings(cwd);
  const projectSettingsResult = projectTestSettings?.runSelfTests?.();
  return [`TDD workflow helper self-tests passed (${assertionCount()} assertions).`, projectSettingsResult]
    .filter(Boolean)
    .join("\n");
}
