import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkflowCheckFeedback } from "./checks";
import {
  formatDisabledWorkflowTools,
  parseSupervisionModeCommand,
  parseWorkflowToggleAction,
  parseWorkflowToolCommand,
  workflowStatusMessage,
} from "./commands";
import { guardedMutationRejectionMessage, mutationGuardReason, resolveMutationTargetPath } from "./mutation-guard";
import { DEFAULT_PROJECT_TEST_SETTINGS_PATH, DEFAULT_WORKFLOW_DISABLED_TOOLS, MUTATION_TOOLS } from "./types";
import type { ProjectTestSettings, SupervisionMode } from "./types";

export type WorkflowControllerDependencies = {
  loadProjectTestSettings(cwd: string): Promise<ProjectTestSettings | undefined>;
  runWorkflowChecks(pi: ExtensionAPI, ctx: ExtensionContext): Promise<WorkflowCheckFeedback>;
  runSelfTests(cwd: string): Promise<string>;
};

export class WorkflowController {
  private checkQueue: Promise<WorkflowCheckFeedback> = Promise.resolve({
    summaryFeedback: "",
    llmFeedback: "",
    userFeedback: "",
  });
  private workflowEnabled = false;
  private supervisionMode: SupervisionMode = "auto";
  private readonly workflowDisabledTools = new Set(DEFAULT_WORKFLOW_DISABLED_TOOLS);
  private activeToolsBeforeWorkflow: string[] | undefined;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly deps: WorkflowControllerDependencies,
  ) {}

  async onSessionStart(_event: unknown, ctx: ExtensionContext): Promise<void> {
    const projectTestSettings = await this.deps.loadProjectTestSettings(ctx.cwd);
    this.workflowEnabled = projectTestSettings?.isProjectRepository(ctx.cwd) ?? false;
    this.applyWorkflowToolPolicy(this.workflowEnabled);
    ctx.ui.setStatus("tdd-workflow", this.workflowEnabled ? "workflow: on" : "workflow: off");
    ctx.ui.setStatus("tdd-supervision", `supervision: ${this.supervisionMode}`);

    if (ctx.hasUI) {
      ctx.ui.notify(
        this.workflowEnabled
          ? "TDD workflow helper loaded: write/edit tools will trigger checks."
          : `TDD workflow helper loaded without active project settings at ${DEFAULT_PROJECT_TEST_SETTINGS_PATH}.`,
        "info",
      );
    }
  }

  async handleWorkflowCommand(args: string, ctx: ExtensionContext): Promise<void> {
    const action = parseWorkflowToggleAction(args);

    if (action === undefined) {
      ctx.ui.notify("Usage: /tdd-workflow [on|off|status]", "error");
      return;
    }

    if (action === "on") {
      this.workflowEnabled = true;
    } else if (action === "off") {
      this.workflowEnabled = false;
    }

    this.applyWorkflowToolPolicy(this.workflowEnabled);
    ctx.ui.setStatus("tdd-workflow", this.workflowEnabled ? "workflow: on" : "workflow: off");
    ctx.ui.notify(workflowStatusMessage(this.workflowEnabled), "info");
  }

  async handleSupervisionCommand(args: string, ctx: ExtensionContext): Promise<void> {
    const command = parseSupervisionModeCommand(args);

    if (command === undefined) {
      ctx.ui.notify("Usage: /tdd-workflow-supervision [auto|supervised|unsupervised|status]", "error");
      return;
    }

    if (command.action !== "status") {
      this.supervisionMode = command.action;
    }

    ctx.ui.setStatus("tdd-supervision", `supervision: ${this.supervisionMode}`);
    ctx.ui.notify(`TDD workflow supervision mode is ${this.supervisionMode}.`, "info");
  }

  async handleToolsCommand(args: string, ctx: ExtensionContext): Promise<void> {
    const command = parseWorkflowToolCommand(args);

    if (command === undefined) {
      ctx.ui.notify("Usage: /tdd-workflow-tools [status|disable <tool>|enable <tool>]", "error");
      return;
    }

    if (command.action === "disable" && command.tool !== undefined) {
      this.workflowDisabledTools.add(command.tool);
    } else if (command.action === "enable" && command.tool !== undefined) {
      this.workflowDisabledTools.delete(command.tool);
    }

    if (this.workflowEnabled) {
      this.pi.setActiveTools(this.activeToolsBeforeWorkflow ?? this.getActiveToolNames());
      this.activeToolsBeforeWorkflow = undefined;
      this.applyWorkflowToolPolicy(true);
    }

    ctx.ui.notify(`Workflow-disabled tools: ${formatDisabledWorkflowTools(this.workflowDisabledTools)}.`, "info");
  }

  async handleChecksCommand(_args: string, ctx: ExtensionContext): Promise<void> {
    const feedback = await this.deps.runWorkflowChecks(this.pi, ctx);
    this.pi.sendMessage({
      customType: "tdd-workflow-checks",
      content: feedback.summaryFeedback,
      display: true,
      details: { userFeedback: feedback.userFeedback },
    });
    this.pi.sendMessage({
      customType: "tdd-workflow-checks-llm",
      content: feedback.llmFeedback,
      display: false,
    });
  }

  async handleHelperTestCommand(_args: string, ctx: ExtensionContext): Promise<void> {
    try {
      const result = await this.deps.runSelfTests(ctx.cwd);
      if (!ctx.hasUI) {
        process.stderr.write(`${result}\n`);
      }
      ctx.ui.notify(result, "info");
      this.pi.sendMessage(
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
  }

  async handleToolCall(event: { toolName: string; input: unknown }, ctx: ExtensionContext): Promise<{ block: true; reason: string } | undefined> {
    if (!MUTATION_TOOLS.has(event.toolName)) {
      return undefined;
    }

    const projectTestSettings = await this.deps.loadProjectTestSettings(ctx.cwd);
    const targetPath = resolveMutationTargetPath(ctx.cwd, event.input);
    if (targetPath === undefined) {
      return undefined;
    }

    const reason = mutationGuardReason(ctx.cwd, targetPath, projectTestSettings?.guardedPaths);
    if (reason === undefined) {
      return undefined;
    }

    const rejectionMessage = guardedMutationRejectionMessage(reason);
    if (this.isUnsupervisedMode(ctx)) {
      const alwaysReject =
        rejectionMessage.startsWith("Modification of tests rejected.") ||
        rejectionMessage.startsWith("Modifications outside the project are not permitted.");

      if (alwaysReject) {
        return { block: true, reason: rejectionMessage };
      }
    }

    const approved = await ctx.ui.confirm("Guarded file modification", `Allow pi to ${reason}?`);
    if (!approved) {
      return { block: true, reason: rejectionMessage };
    }

    return undefined;
  }

  async handleToolResult(
    event: { toolName: string; isError?: boolean; content: Array<{ type: string; text?: string }>; details?: Record<string, unknown> },
    ctx: ExtensionContext,
  ): Promise<{ content: Array<{ type: string; text?: string }>; details: Record<string, unknown> } | undefined> {
    if (!this.workflowEnabled || !MUTATION_TOOLS.has(event.toolName) || event.isError) {
      return undefined;
    }

    this.checkQueue = this.checkQueue
      .catch(() => ({ summaryFeedback: "", llmFeedback: "", userFeedback: "" }))
      .then(() => this.deps.runWorkflowChecks(this.pi, ctx));

    const feedback = await this.checkQueue;
    if (ctx.hasUI) {
      ctx.ui.notify(feedback.userFeedback, "info");
    }

    return {
      content: [
        ...event.content,
        {
          type: "text" as const,
          text: feedback.llmFeedback,
        },
      ],
      details: {
        ...event.details,
        tddWorkflowChecks: feedback.llmFeedback,
      },
    };
  }

  private getActiveToolNames(): string[] {
    const activeTools = this.pi.getActiveTools() as unknown as Array<string | { name: string }>;
    return activeTools.map((tool) => (typeof tool === "string" ? tool : tool.name));
  }

  private applyWorkflowToolPolicy(enabled: boolean): void {
    if (enabled) {
      this.activeToolsBeforeWorkflow ??= this.getActiveToolNames();
      this.pi.setActiveTools(this.getActiveToolNames().filter((toolName) => !this.workflowDisabledTools.has(toolName)));
      return;
    }

    if (this.activeToolsBeforeWorkflow !== undefined) {
      this.pi.setActiveTools(this.activeToolsBeforeWorkflow);
      this.activeToolsBeforeWorkflow = undefined;
    }
  }

  private isUnsupervisedMode(ctx: ExtensionContext): boolean {
    if (this.supervisionMode === "unsupervised") {
      return true;
    }
    if (this.supervisionMode === "auto" && !ctx.hasUI) {
      return true;
    }

    return false;
  }
}
