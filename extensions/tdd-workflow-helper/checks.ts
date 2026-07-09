import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createJjChangeIfNeeded } from "./jj";
import { formatCommandOutput, formatFullCommandOutput } from "./output";
import { loadProjectTestSettings } from "./project-settings";
import { DEFAULT_PROJECT_TEST_SETTINGS_PATH, type WorkflowTestSummary } from "./types";

export type WorkflowCheckFeedback = {
  summaryFeedback: string;
  llmFeedback: string;
  userFeedback: string;
};

export type WorkflowCheckSection = {
  llmSection: string;
  userSection: string;
};

export function formatWorkflowCheckSummary(summary: WorkflowTestSummary | undefined, failed: boolean): string {
  if (summary === undefined) {
    return failed ? "Checks: failed" : "Checks: passed";
  }

  return `Tests: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`;
}

export function buildWorkflowCheckFeedback(args: {
  label: string;
  ok: boolean;
  code: number;
  killed: boolean;
  evaluatedOutput: string;
  commandOutput: string;
}): WorkflowCheckSection {
  const status = args.ok ? "✅" : "❌";
  const exitCode = `Exit code: ${args.code}${args.killed ? " (timed out/killed)" : ""}`;

  return {
    llmSection: [`### ${status} ${args.label}`, exitCode, "```text", args.evaluatedOutput, "```"].join("\n"),
    userSection: [
      `### ${status} ${args.label}`,
      exitCode,
      "#### Summary",
      "```text",
      args.evaluatedOutput,
      "```",
      "#### Test function output",
      "```text",
      args.commandOutput,
      "```",
    ].join("\n"),
  };
}

/** Runs all workflow checks and returns concise LLM feedback plus full user-visible feedback. */
export async function runWorkflowChecks(pi: ExtensionAPI, ctx: ExtensionContext): Promise<WorkflowCheckFeedback> {
  const startedAt = Date.now();
  const llmSections: string[] = ["## TDD workflow checks"];
  const userSections: string[] = ["## TDD workflow checks"];
  let failed = false;
  let latestTestSummary: WorkflowTestSummary | undefined;

  ctx.ui.setStatus("tdd-workflow-checks", "checks: running");

  try {
    const projectTestSettings = await loadProjectTestSettings(ctx.cwd);
    if (projectTestSettings === undefined) {
      failed = true;
      const message = `Project test settings not found at ${DEFAULT_PROJECT_TEST_SETTINGS_PATH}.`;
      return { summaryFeedback: message, llmFeedback: message, userFeedback: message };
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

      const section = buildWorkflowCheckFeedback({
        label: check.label,
        ok,
        code: result.code,
        killed: result.killed,
        evaluatedOutput: evaluation.output,
        commandOutput: formatFullCommandOutput(result.stdout, result.stderr),
      });
      llmSections.push(section.llmSection);
      userSections.push(section.userSection);

      if (evaluation.continueChecks === false) {
        if (evaluation.stopReason !== undefined) {
          llmSections.push(evaluation.stopReason);
          userSections.push(evaluation.stopReason);
        }
        break;
      }
    }

    const jjResult = await createJjChangeIfNeeded(pi, ctx, latestTestSummary);
    if (jjResult !== undefined) {
      llmSections.push(jjResult);
      userSections.push(jjResult);
    }
  } finally {
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    ctx.ui.setStatus(
      "tdd-workflow-checks",
      failed ? `checks: failed (${elapsedSeconds}s)` : `checks: passed (${elapsedSeconds}s)`,
    );
  }

  return {
    summaryFeedback: formatWorkflowCheckSummary(latestTestSummary, failed),
    llmFeedback: llmSections.join("\n\n"),
    userFeedback: userSections.join("\n\n"),
  };
}
