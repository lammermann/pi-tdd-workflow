import {
  formatDisabledWorkflowTools,
  parseWorkflowToggleAction,
  parseWorkflowToolCommand,
} from "../commands";
import { mutationGuardReason } from "../mutation-guard";
import { loadProjectTestSettings } from "../project-settings";

/** Throws when a self-test expectation is not met. */
function expectEqual<T>(name: string, actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Runs fast unit tests for the extension's pure formatting/parsing logic. */
export async function runSelfTests(cwd: string): Promise<string> {
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

  const projectTestSettings = await loadProjectTestSettings(cwd);
  const projectSettingsResult = projectTestSettings?.runSelfTests?.();
  return ["TDD workflow helper self-tests passed (9 assertions).", projectSettingsResult]
    .filter(Boolean)
    .join("\n");
}
