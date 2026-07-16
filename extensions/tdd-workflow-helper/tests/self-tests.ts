import { buildWorkflowCheckFeedback, formatWorkflowCheckSummary, shouldContinueWorkflowChecks } from "../checks";
import {
  formatDisabledWorkflowTools,
  parseSupervisionModeCommand,
  parseWorkflowToggleAction,
  parseWorkflowToolCommand,
} from "../commands";
import { guardedMutationRejectionMessage, mutationGuardReason } from "../mutation-guard";
import { loadProjectTestSettings } from "../project-settings";

/** Runs fast unit tests for the extension's pure formatting/parsing logic. */
export async function runSelfTests(cwd: string): Promise<string> {
  const [expectEqual, assertionCount] = createExpectEqual();
  // command parsing
  expectEqual("toggle parses enable alias", parseWorkflowToggleAction("enable"), "on");
  expectEqual("toggle parses deactivate alias", parseWorkflowToggleAction("deactivate"), "off");
  expectEqual("toggle rejects unknown action", parseWorkflowToggleAction("maybe"), undefined);
  expectEqual("tool policy parses disable", parseWorkflowToolCommand("disable bash")?.action, "disable");
  expectEqual("tool policy parses enable tool", parseWorkflowToolCommand("allow bash")?.tool, "bash");
  expectEqual("tool policy formats empty list", formatDisabledWorkflowTools(new Set()), "none");
  expectEqual("supervision mode defaults to status", parseSupervisionModeCommand("")?.action, "status");
  expectEqual("supervision mode parses unsupervised", parseSupervisionModeCommand("unsupervised")?.action, "unsupervised");
  expectEqual("supervision mode parses common typo", parseSupervisionModeCommand("unsuperwised")?.action, "unsupervised");
  expectEqual("supervision mode parses supervised", parseSupervisionModeCommand("supervised")?.action, "supervised");
  expectEqual("supervision mode parses auto", parseSupervisionModeCommand("auto")?.action, "auto");
  expectEqual("supervision mode rejects unknown action", parseSupervisionModeCommand("maybe"), undefined);

  // project modification guard
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
  // TODO test different reaction in supervised and unsupervised mode
  expectEqual(
    "test modification rejection gives implementation guidance",
    guardedMutationRejectionMessage("modify guarded test file: test/foo_test.dart"),
    "Modification of tests rejected. Implement them instead. If not possible cleanly add a note in test_suggestions.adoc and go on with the other tests.",
  );
  expectEqual(
    "configured test modification rejection gives implementation guidance",
    guardedMutationRejectionMessage("modify configured guarded file: extensions/helper/tests/self-tests.ts"),
    "Modification of tests rejected. Implement them instead. If not possible cleanly add a note in test_suggestions.adoc and go on with the other tests.",
  );
  expectEqual(
    "outside project rejection forbids retries",
    guardedMutationRejectionMessage("modify file outside the project directory: /tmp/file.txt"),
    "Modifications outside the project are not permitted. Do not try it again.",
  );

  // workflow feedback
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
  expectEqual(
    "workflow check summary includes additional message",
    formatWorkflowCheckSummary({ passed: 0, failed: 1, skipped: 0, total: 1, msg: "parse error" }, true),
    "Tests: 0 passed, 1 failed, 0 skipped — parse error",
  );
  expectEqual(
    "workflow checks continue after a passing command",
    shouldContinueWorkflowChecks({ ok: true, testSummary: { passed: 1, failed: 0, skipped: 0, total: 1 } }),
    true,
  );
  expectEqual(
    "workflow checks stop after a failing command exit",
    shouldContinueWorkflowChecks({ ok: false }),
    false,
  );
  expectEqual(
    "workflow checks stop after a failing test summary",
    shouldContinueWorkflowChecks({ ok: true, testSummary: { passed: 0, failed: 1, skipped: 0, total: 1 } }),
    false,
  );
  expectEqual(
    "workflow checks honor explicit project stop",
    shouldContinueWorkflowChecks({ ok: true, continueChecks: false }),
    false,
  );

  const projectTestSettings = await loadProjectTestSettings(cwd);
  const projectSettingsResult = projectTestSettings?.runSelfTests?.();
  return [`TDD workflow helper self-tests passed (${assertionCount()} assertions).`, projectSettingsResult]
    .filter(Boolean)
    .join("\n");
}

/** Helper function: Create an assert function that counts the number of assertions
*/
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

