import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runWorkflowChecks } from "./checks";
import {
  formatDisabledWorkflowTools,
  parseWorkflowToggleAction,
  parseWorkflowToolCommand,
  workflowStatusMessage,
} from "./commands";
import { mutationGuardReason, resolveMutationTargetPath } from "./mutation-guard";
import { loadProjectTestSettings } from "./project-settings";
import { runSelfTests } from "./tests/self-tests";
import {
  DEFAULT_PROJECT_TEST_SETTINGS_PATH,
  DEFAULT_WORKFLOW_DISABLED_TOOLS,
  MUTATION_TOOLS,
} from "./types";
export type {
  CheckCommand,
  CheckEvaluation,
  ProjectTestSettings,
  WorkflowTestSummary,
} from "./types";

export default function (pi: ExtensionAPI) {
  /** Serializes checks so parallel edit/write tool calls do not run project checks concurrently. */
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
