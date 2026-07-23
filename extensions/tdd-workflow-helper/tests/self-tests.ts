import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildWorkflowCheckFeedback, formatWorkflowCheckSummary, runWorkflowChecks, shouldContinueWorkflowChecks } from "../checks";
import {
  formatDisabledWorkflowTools,
  parseSupervisionModeCommand,
  parseWorkflowToggleAction,
  parseWorkflowToolCommand,
} from "../commands";
import { createJjChangeIfNeeded } from "../jj";
import { guardedMutationRejectionMessage, mutationGuardReason, resolveMutationTargetPath } from "../mutation-guard";
import { formatCommandOutput, formatFullCommandOutput } from "../output";
import { loadProjectTestSettings } from "../project-settings";

/** Runs fast unit tests for the extension's pure formatting/parsing logic. */
export async function runSelfTests(cwd: string): Promise<string> {
  const [expectEqual, assertionCount] = createExpectEqual();
  // command parsing
  expectEqual("toggle defaults to status so users can inspect without changing state", parseWorkflowToggleAction(""), "status");
  expectEqual("toggle parses enable alias", parseWorkflowToggleAction("enable"), "on");
  expectEqual("toggle parses activate alias", parseWorkflowToggleAction("activated"), "on");
  expectEqual("toggle parses deactivate alias", parseWorkflowToggleAction("deactivate"), "off");
  expectEqual("toggle parses disable alias", parseWorkflowToggleAction("disabled"), "off");
  expectEqual("toggle rejects unknown action", parseWorkflowToggleAction("maybe"), undefined);
  expectEqual("tool policy defaults to status so users can inspect disabled tools", parseWorkflowToolCommand("")?.action, "status");
  expectEqual("tool policy parses disable", parseWorkflowToolCommand("disable bash")?.action, "disable");
  expectEqual("tool policy parses deny alias", parseWorkflowToolCommand("deny bash")?.action, "disable");
  expectEqual("tool policy parses remove alias", parseWorkflowToolCommand("remove bash")?.action, "disable");
  expectEqual("tool policy parses enable tool", parseWorkflowToolCommand("allow bash")?.tool, "bash");
  expectEqual("tool policy parses add alias", parseWorkflowToolCommand("add bash")?.action, "enable");
  expectEqual("tool policy rejects incomplete mutation", parseWorkflowToolCommand("disable"), undefined);
  expectEqual("tool policy rejects ambiguous mutation", parseWorkflowToolCommand("disable bash edit"), undefined);
  expectEqual("tool policy formats empty list", formatDisabledWorkflowTools(new Set()), "none");
  expectEqual("tool policy formats sorted names for stable status text", formatDisabledWorkflowTools(new Set(["write", "bash", "edit"])), "bash, edit, write");
  expectEqual("supervision mode defaults to status", parseSupervisionModeCommand("")?.action, "status");
  expectEqual("supervision mode parses unsupervised", parseSupervisionModeCommand("unsupervised")?.action, "unsupervised");
  expectEqual("supervision mode parses common typo", parseSupervisionModeCommand("unsuperwised")?.action, "unsupervised");
  expectEqual("supervision mode parses supervised", parseSupervisionModeCommand("supervised")?.action, "supervised");
  expectEqual("supervision mode parses auto", parseSupervisionModeCommand("auto")?.action, "auto");
  expectEqual("supervision mode rejects unknown action", parseSupervisionModeCommand("maybe"), undefined);

  // output formatting
  expectEqual("full command output explains silent commands", formatFullCommandOutput("", ""), "<no output>");
  expectEqual("full command output preserves stdout", formatFullCommandOutput("hello\n", ""), "hello");
  expectEqual("full command output preserves stderr", formatFullCommandOutput("", "warn\n"), "warn");
  expectEqual("full command output keeps stdout before stderr", formatFullCommandOutput("out\n", "err\n"), "out\nerr");
  const longOutput = `${"a".repeat(4100)}tail`;
  expectEqual("LLM command output truncates old content", formatCommandOutput(longOutput, "").startsWith("... truncated"), true);
  expectEqual("LLM command output keeps the newest output tail", formatCommandOutput(longOutput, "").endsWith("tail"), true);

  // project modification guard
  expectEqual("mutation target ignores non-object input", resolveMutationTargetPath("/repo", "not an object"), undefined);
  expectEqual("mutation target ignores missing path", resolveMutationTargetPath("/repo", {}), undefined);
  expectEqual("mutation target ignores blank path", resolveMutationTargetPath("/repo", { path: "   " }), undefined);
  expectEqual("mutation target resolves project-relative paths", resolveMutationTargetPath("/repo", { path: "lib/main.dart" }), resolve("/repo/lib/main.dart"));
  expectEqual("mutation target preserves absolute paths", resolveMutationTargetPath("/repo", { path: "/tmp/file.txt" }), resolve("/tmp/file.txt"));
  expectEqual("mutation target strips pi attachment marker", resolveMutationTargetPath("/repo", { path: "@lib/main.dart" }), resolve("/repo/lib/main.dart"));
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
    "project path guard catches top-level test directory itself",
    mutationGuardReason("/repo", "/repo/test"),
    "modify guarded test file: test",
  );
  expectEqual(
    "project path guard catches top-level tests directory itself",
    mutationGuardReason("/repo", "/repo/tests"),
    "modify guarded test file: tests",
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
  expectEqual(
    "project path guard supports simple configured globs",
    mutationGuardReason("/repo", "/repo/package.json", ["*.json"]),
    "modify configured guarded file: package.json",
  );
  expectEqual(
    "project path guard leaves non-matching configured globs alone",
    mutationGuardReason("/repo", "/repo/package.json", ["*.ts"]),
    undefined,
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
  expectEqual(
    "project settings rejection explains the specific guarded reason",
    guardedMutationRejectionMessage("modify guarded project test settings file: .pi/project-test-settings.ts"),
    "Modification rejected because this path is guarded: modify guarded project test settings file: .pi/project-test-settings.ts",
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

