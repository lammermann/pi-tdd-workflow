import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Tool names that mutate repository files through pi's built-in tools. */
const MUTATION_TOOLS = new Set(["edit", "write"]);

/** Maximum number of output characters included per command in the LLM-visible feedback. */
const MAX_OUTPUT_CHARS = 4000;

/** Tools disabled while the workflow is active. */
const DEFAULT_WORKFLOW_DISABLED_TOOLS = ["bash"];

/** User-facing actions supported by the workflow toggle command. */
type WorkflowToggleAction = "on" | "off" | "status";

/** User-facing actions supported by the workflow tool policy command. */
type WorkflowToolAction = "disable" | "enable" | "status";

/**
 * Structural mirror of `.pi/workflow-helper-api.ts` used for dynamic settings.
 *
 * The extension intentionally does not import that project-local file statically:
 * this extension may be installed outside the project, for example in
 * `~/.pi/extensions`, while `.pi/workflow-helper-api.ts` belongs to the active
 * project. TypeScript types cannot be passed through dynamic imports at runtime,
 * so the extension keeps this compatible structural copy for its own checks.
 *
 * TODO(shared package): Move these exported types and the project-local
 * `.pi/workflow-helper-api.ts` types into a shared package such as
 * `@your-org/pi-workflow-helper-api`. Then import the package from both this
 * extension and each project's `.pi/project-test-settings.ts`. Once all users can
 * resolve that package from their extension installation location, remove this
 * structural mirror.
 */

/** Validation command executed after each successful file mutation. */
export type CheckCommand = {
  label: string;
  command: string;
  args: string[];
  timeout: number;
  /** Optional project-defined metadata used by external settings. */
  kind?: string;
};

/** Generic test result counters consumed by the workflow automation. */
export type WorkflowTestSummary = {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
};

/** Result returned by project settings after a workflow command finishes. */
export type CheckEvaluation = {
  output: string;
  testSummary?: WorkflowTestSummary;
  continueChecks?: boolean;
  stopReason?: string;
};

/** Default project-relative location for workflow validation settings. */
const DEFAULT_PROJECT_TEST_SETTINGS_PATH = ".pi/project-test-settings.ts";

/** Project-specific test and validation behavior loaded from `.pi/project-test-settings.ts`. */
export type ProjectTestSettings = {
  checkCommands: CheckCommand[];
  isProjectRepository(cwd: string): boolean;
  evaluateCheck(args: {
    check: CheckCommand;
    stdout: string;
    stderr: string;
    ok: boolean;
    formatCommandOutput(stdout: string, stderr: string): string;
  }): CheckEvaluation;
  runSelfTests?(): string;
};

/** Loads project-specific settings from the current project's `.pi` directory. */
async function loadProjectTestSettings(cwd: string): Promise<ProjectTestSettings | undefined> {
  const settingsPath = resolve(cwd, DEFAULT_PROJECT_TEST_SETTINGS_PATH);
  if (!existsSync(settingsPath)) {
    return undefined;
  }

  const settingsUrl = pathToFileURL(settingsPath);
  settingsUrl.searchParams.set("mtime", String(statSync(settingsPath).mtimeMs));
  const module = (await import(settingsUrl.href)) as { default?: ProjectTestSettings };
  return module.default;
}

/** Parses the optional workflow toggle command argument. */
function parseWorkflowToggleAction(args: string): WorkflowToggleAction | undefined {
  const normalized = args.trim().toLowerCase();

  if (normalized === "" || normalized === "status") {
    return "status";
  }
  if (["on", "enable", "enabled", "activate", "activated"].includes(normalized)) {
    return "on";
  }
  if (["off", "disable", "disabled", "deactivate", "deactivated"].includes(normalized)) {
    return "off";
  }

  return undefined;
}

/** Parses the workflow tool policy command argument. */
function parseWorkflowToolCommand(args: string): { action: WorkflowToolAction; tool?: string } | undefined {
  const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (parts.length === 0 || (parts.length === 1 && parts[0] === "status")) {
    return { action: "status" };
  }

  if (parts.length !== 2) {
    return undefined;
  }

  const [rawAction, tool] = parts;
  if (["disable", "deny", "off", "remove"].includes(rawAction)) {
    return { action: "disable", tool };
  }
  if (["enable", "allow", "on", "add"].includes(rawAction)) {
    return { action: "enable", tool };
  }

  return undefined;
}

/** Formats disabled workflow tools for status messages. */
function formatDisabledWorkflowTools(disabledTools: Set<string>): string {
  if (disabledTools.size === 0) {
    return "none";
  }

  return [...disabledTools].sort().join(", ");
}

/** Builds a concise status message for the automatic workflow. */
function workflowStatusMessage(enabled: boolean): string {
  return `TDD workflow checks are ${enabled ? "enabled" : "disabled"}.`;
}

/** Returns whether a resolved path points outside the current project directory. */
function isOutsideProjectDirectory(cwd: string, absolutePath: string): boolean {
  const relativePath = relative(cwd, absolutePath);
  return relativePath === "" ? false : relativePath.startsWith("..") || isAbsolute(relativePath);
}

/** Returns whether a resolved path points into a guarded top-level test directory. */
function isInGuardedTestDirectory(cwd: string, absolutePath: string): boolean {
  const relativePath = relative(cwd, absolutePath).replace(/\\/g, "/");
  return (
    relativePath === "test" ||
    relativePath.startsWith("test/") ||
    relativePath === "tests" ||
    relativePath.startsWith("tests/")
  );
}

/** Extracts and resolves the target file path from built-in edit/write tool input. */
function resolveMutationTargetPath(cwd: string, input: unknown): string | undefined {
  if (input === null || typeof input !== "object" || !("path" in input)) {
    return undefined;
  }

  const rawPath = (input as { path?: unknown }).path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    return undefined;
  }

  return resolve(cwd, rawPath.startsWith("@") ? rawPath.slice(1) : rawPath);
}

/** Builds the confirmation message required before guarded mutations. */
function mutationGuardReason(cwd: string, absolutePath: string): string | undefined {
  if (isOutsideProjectDirectory(cwd, absolutePath)) {
    return `modify file outside the project directory: ${absolutePath}`;
  }
  if (isInGuardedTestDirectory(cwd, absolutePath)) {
    return `modify guarded test file: ${relative(cwd, absolutePath)}`;
  }

  return undefined;
}

/** Truncates long command output while preserving the most recent lines. */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }

  return `... truncated ${output.length - MAX_OUTPUT_CHARS} chars ...\n${output.slice(-MAX_OUTPUT_CHARS)}`;
}

/** Formats command output for inclusion in a tool result. */
function formatCommandOutput(stdout: string, stderr: string): string {
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return truncateOutput(combined || "<no output>");
}

/** Throws when a self-test expectation is not met. */
function expectEqual<T>(name: string, actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Runs fast unit tests for the extension's pure formatting/parsing logic. */
async function runSelfTests(cwd: string): Promise<string> {
  expectEqual("toggle parses enable alias", parseWorkflowToggleAction("enable"), "on");
  expectEqual("toggle parses deactivate alias", parseWorkflowToggleAction("deactivate"), "off");
  expectEqual("toggle rejects unknown action", parseWorkflowToggleAction("maybe"), undefined);
  expectEqual("tool policy parses disable", parseWorkflowToolCommand("disable bash")?.action, "disable");
  expectEqual("tool policy parses enable tool", parseWorkflowToolCommand("allow bash")?.tool, "bash");
  expectEqual("tool policy formats empty list", formatDisabledWorkflowTools(new Set()), "none");
  expectEqual("project path guard allows lib file", mutationGuardReason("/repo", "/repo/lib/main.dart"), undefined);
  expectEqual("project path guard catches outside file", mutationGuardReason("/repo", "/tmp/file.txt"), "modify file outside the project directory: /tmp/file.txt");
  expectEqual("project path guard catches test file", mutationGuardReason("/repo", "/repo/test/foo_test.dart"), "modify guarded test file: test/foo_test.dart");

  const projectTestSettings = await loadProjectTestSettings(cwd);
  const projectSettingsResult = projectTestSettings?.runSelfTests?.();
  return ["TDD workflow helper self-tests passed (9 assertions).", projectSettingsResult]
    .filter(Boolean)
    .join("\n");
}

/** Describes the working-copy commit and starts a new jj change when tests passed. */
async function createJjChangeIfNeeded(
  pi: ExtensionAPI,
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

/** Runs all workflow checks and returns a concise Markdown summary. */
async function runWorkflowChecks(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
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

export default function (pi: ExtensionAPI) {
  /** Serializes checks so parallel edit/write tool calls do not run Flutter tests concurrently. */
  let checkQueue: Promise<string> = Promise.resolve("");

  /** Session-local toggle for automatic checks after file mutation tools. */
  let workflowEnabled = false;

  /** Tool names disabled while the workflow is active. */
  const workflowDisabledTools = new Set(DEFAULT_WORKFLOW_DISABLED_TOOLS);

  /** Active tool names captured before applying the workflow tool policy. */
  let activeToolsBeforeWorkflow: string[] | undefined;

  /** Reads active tool names, normalizing possible tool metadata objects. */
  function getActiveToolNames(): string[] {
    const activeTools = pi.getActiveTools() as unknown as Array<string | { name: string }>;
    return activeTools.map((tool) => (typeof tool === "string" ? tool : tool.name));
  }

  /** Applies or restores the active-tool policy associated with the workflow. */
  function applyWorkflowToolPolicy(enabled: boolean): void {
    if (enabled) {
      activeToolsBeforeWorkflow ??= getActiveToolNames();
      pi.setActiveTools(getActiveToolNames().filter((toolName) => !workflowDisabledTools.has(toolName)));
      return;
    }

    if (activeToolsBeforeWorkflow !== undefined) {
      pi.setActiveTools(activeToolsBeforeWorkflow);
      activeToolsBeforeWorkflow = undefined;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    const projectTestSettings = await loadProjectTestSettings(ctx.cwd);
    workflowEnabled = projectTestSettings?.isProjectRepository(ctx.cwd) ?? false;
    applyWorkflowToolPolicy(workflowEnabled);
    ctx.ui.setStatus("tdd-workflow", workflowEnabled ? "workflow: on" : "workflow: off");

    if (ctx.hasUI) {
      ctx.ui.notify(
        workflowEnabled
          ? "TDD workflow helper loaded: write/edit tools will trigger checks."
          : `TDD workflow helper loaded without active project settings at ${DEFAULT_PROJECT_TEST_SETTINGS_PATH}.`,
        "info",
      );
    }
  });

  pi.registerCommand("tdd-workflow", {
    description: "Enable, disable, or show status for automatic TDD workflow checks",
    handler: async (args, ctx) => {
      const action = parseWorkflowToggleAction(args);

      if (action === undefined) {
        ctx.ui.notify("Usage: /tdd-workflow [on|off|status]", "error");
        return;
      }

      if (action === "on") {
        workflowEnabled = true;
      } else if (action === "off") {
        workflowEnabled = false;
      }

      applyWorkflowToolPolicy(workflowEnabled);
      ctx.ui.setStatus("tdd-workflow", workflowEnabled ? "workflow: on" : "workflow: off");
      ctx.ui.notify(workflowStatusMessage(workflowEnabled), "info");
    },
  });

  pi.registerCommand("tdd-workflow-tools", {
    description: "Configure tools disabled while the TDD workflow is active",
    handler: async (args, ctx) => {
      const command = parseWorkflowToolCommand(args);

      if (command === undefined) {
        ctx.ui.notify("Usage: /tdd-workflow-tools [status|disable <tool>|enable <tool>]", "error");
        return;
      }

      if (command.action === "disable" && command.tool !== undefined) {
        workflowDisabledTools.add(command.tool);
      } else if (command.action === "enable" && command.tool !== undefined) {
        workflowDisabledTools.delete(command.tool);
      }

      if (workflowEnabled) {
        pi.setActiveTools(activeToolsBeforeWorkflow ?? getActiveToolNames());
        activeToolsBeforeWorkflow = undefined;
        applyWorkflowToolPolicy(true);
      }

      ctx.ui.notify(
        `Workflow-disabled tools: ${formatDisabledWorkflowTools(workflowDisabledTools)}.`,
        "info",
      );
    },
  });

  pi.registerCommand("tdd-workflow-checks", {
    description: "Run the TDD workflow checks without editing files",
    handler: async (_args, ctx) => {
      const feedback = await runWorkflowChecks(pi, ctx);
      pi.sendMessage(
        {
          customType: "tdd-workflow-checks",
          content: feedback,
          display: true,
        },
        { deliverAs: "nextTurn" },
      );
    },
  });

  pi.registerCommand("tdd-workflow-helper-test", {
    description: "Run fast unit tests for the TDD workflow helper extension",
    handler: async (_args, ctx) => {
      try {
        const result = await runSelfTests(ctx.cwd);
        ctx.ui.notify(result, "info");
        pi.sendMessage(
          {
            customType: "tdd-workflow-helper-test",
            content: result,
            display: true,
          },
          { deliverAs: "nextTurn" },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`TDD workflow helper self-tests failed: ${message}`, "error");
        throw error;
      }
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!MUTATION_TOOLS.has(event.toolName)) {
      return;
    }

    const targetPath = resolveMutationTargetPath(ctx.cwd, event.input);
    if (targetPath === undefined) {
      return;
    }

    const reason = mutationGuardReason(ctx.cwd, targetPath);
    if (reason === undefined) {
      return;
    }

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Blocked guarded modification without interactive confirmation: ${reason}`,
      };
    }

    const approved = await ctx.ui.confirm("Guarded file modification", `Allow pi to ${reason}?`);
    if (!approved) {
      return { block: true, reason: `User rejected guarded modification: ${reason}` };
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!workflowEnabled || !MUTATION_TOOLS.has(event.toolName) || event.isError) {
      return;
    }

    checkQueue = checkQueue
      .catch(() => "")
      .then(() => runWorkflowChecks(pi, ctx));

    const feedback = await checkQueue;

    return {
      content: [
        ...event.content,
        {
          type: "text" as const,
          text: feedback,
        },
      ],
      details: {
        ...event.details,
        tddWorkflowChecks: feedback,
      },
    };
  });
}
