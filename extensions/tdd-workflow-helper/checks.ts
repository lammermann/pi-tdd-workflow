import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createJjChangeIfNeeded } from "./jj";
import { formatCommandOutput } from "./output";
import { loadProjectTestSettings } from "./project-settings";
import { DEFAULT_PROJECT_TEST_SETTINGS_PATH, type WorkflowTestSummary } from "./types";

/** Runs all workflow checks and returns a concise Markdown summary. */
export async function runWorkflowChecks(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
  const startedAt = Date.now();
  const sections: string[] = ["## TDD workflow checks"];
  let failed = false;
  let latestTestSummary: WorkflowTestSummary | undefined;

  ctx.ui.setStatus("tdd-workflow-checks", "checks: running");

  try {
    const projectTestSettings = await loadProjectTestSettings(ctx.cwd);
    if (projectTestSettings === undefined) {
      failed = true;
      return `Project test settings not found at ${DEFAULT_PROJECT_TEST_SETTINGS_PATH}.`;
    }

    for (const check of projectTestSettings.checkCommands) {
      const result = await pi.exec(check.command, check.args, {
        signal: ctx.signal,
        timeout: check.timeout,
      });
      const ok = result.code === 0 && !result.killed;
      failed ||= !ok;

      const evaluation = projectTestSettings.evaluateCheck({
        check,
        stdout: result.stdout,
        stderr: result.stderr,
        ok,
        formatCommandOutput,
      });
      latestTestSummary = evaluation.testSummary ?? latestTestSummary;

      sections.push(
        [
          `### ${ok ? "✅" : "❌"} ${check.label}`,
          `Exit code: ${result.code}${result.killed ? " (timed out/killed)" : ""}`,
          "```text",
          evaluation.output,
          "```",
        ].join("\n"),
      );

      if (evaluation.continueChecks === false) {
        if (evaluation.stopReason !== undefined) {
          sections.push(evaluation.stopReason);
        }
        break;
      }
    }

    const jjResult = await createJjChangeIfNeeded(pi, ctx, latestTestSummary);
    if (jjResult !== undefined) {
      sections.push(jjResult);
    }
  } finally {
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    ctx.ui.setStatus(
      "tdd-workflow-checks",
      failed ? `checks: failed (${elapsedSeconds}s)` : `checks: passed (${elapsedSeconds}s)`,
    );
  }

  return sections.join("\n\n");
}
