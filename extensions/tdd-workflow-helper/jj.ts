import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatCommandOutput } from "./output";
import type { WorkflowTestSummary } from "./types";

/** Describes the working-copy commit and starts a new jj change when tests passed. */
export async function createJjChangeIfNeeded(
  pi: Pick<ExtensionAPI, "exec">,
  ctx: ExtensionContext,
  testSummary: WorkflowTestSummary | undefined,
): Promise<string | undefined> {
  if (
    testSummary === undefined ||
    testSummary.passed === 0 ||
    testSummary.failed > 0 ||
    testSummary.passed + testSummary.skipped !== testSummary.total
  ) {
    return undefined;
  }

  const status = await pi.exec("jj", ["status", "--no-pager"], {
    signal: ctx.signal,
    timeout: 30_000,
  });

  if (status.code !== 0 || status.killed) {
    return [
      "### ❌ jj status --no-pager",
      `Exit code: ${status.code}${status.killed ? " (timed out/killed)" : ""}`,
      "```text",
      formatCommandOutput(status.stdout, status.stderr),
      "```",
    ].join("\n");
  }

  if (status.stdout.includes("The working copy has no changes.")) {
    return undefined;
  }

  const existingDescription = await pi.exec("jj", ["log", "-r", "@", "--no-graph", "-T", "description"], {
    signal: ctx.signal,
    timeout: 30_000,
  });

  if (existingDescription.code !== 0 || existingDescription.killed) {
    return [
      "### ❌ jj log -r @ --no-graph -T description",
      `Exit code: ${existingDescription.code}${existingDescription.killed ? " (timed out/killed)" : ""}`,
      "```text",
      formatCommandOutput(existingDescription.stdout, existingDescription.stderr),
      "```",
    ].join("\n");
  }

  const description = `Tests: ${testSummary.passed} passed, ${testSummary.failed} failed, ${testSummary.skipped} skipped`;
  const hasExistingDescription = existingDescription.stdout.trim().length > 0;

  if (!hasExistingDescription) {
    const describe = await pi.exec("jj", ["describe", "-m", description], {
      signal: ctx.signal,
      timeout: 30_000,
    });

    if (describe.code !== 0 || describe.killed) {
      return [
        "### ❌ jj describe",
        `Exit code: ${describe.code}${describe.killed ? " (timed out/killed)" : ""}`,
        "```text",
        formatCommandOutput(describe.stdout, describe.stderr),
        "```",
      ].join("\n");
    }
  }

  const nextChange = await pi.exec("jj", ["new"], {
    signal: ctx.signal,
    timeout: 30_000,
  });

  return [
    `### ${nextChange.code === 0 && !nextChange.killed ? "✅" : "❌"} jj new`,
    hasExistingDescription
      ? `Existing description preserved: ${existingDescription.stdout.trim()}`
      : `Description: ${description}`,
    `Exit code: ${nextChange.code}${nextChange.killed ? " (timed out/killed)" : ""}`,
    "```text",
    formatCommandOutput(nextChange.stdout, nextChange.stderr),
    "```",
  ].join("\n");
}
