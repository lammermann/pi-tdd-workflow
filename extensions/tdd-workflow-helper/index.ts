import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runWorkflowChecks } from "./checks";
import { loadProjectTestSettings } from "./project-settings";
import { runSelfTests } from "./tests/self-tests";
import { WorkflowController } from "./workflow-controller";
import { renderWorkflowChecksMessage } from "./workflow-renderer";
export type {
  CheckCommand,
  CheckEvaluation,
  ProjectTestSettings,
  SupervisionMode,
  WorkflowTestSummary,
} from "./types";

export default function (pi: ExtensionAPI) {
  const controller = new WorkflowController(pi, {
    loadProjectTestSettings,
    runWorkflowChecks,
    runSelfTests,
  });

  pi.registerMessageRenderer("tdd-workflow-checks", (message, options) =>
    renderWorkflowChecksMessage(message, options.expanded),
  );

  pi.on("session_start", (event, ctx) => controller.onSessionStart(event, ctx));
  pi.on("tool_call", (event, ctx) => controller.handleToolCall(event, ctx));
  pi.on("tool_result", (event, ctx) => controller.handleToolResult(event, ctx));

  pi.registerCommand("tdd-workflow", {
    description: "Enable, disable, or show status for automatic TDD workflow checks",
    handler: (args, ctx) => controller.handleWorkflowCommand(args, ctx),
  });

  pi.registerCommand("tdd-workflow-supervision", {
    description: "Set whether edit/write tools are supervised, unsupervised, or auto-detected",
    handler: (args, ctx) => controller.handleSupervisionCommand(args, ctx),
  });

  pi.registerCommand("tdd-workflow-tools", {
    description: "Configure tools disabled while the TDD workflow is active",
    handler: (args, ctx) => controller.handleToolsCommand(args, ctx),
  });

  pi.registerCommand("tdd-workflow-checks", {
    description: "Run the TDD workflow checks without editing files",
    handler: (args, ctx) => controller.handleChecksCommand(args, ctx),
  });

  pi.registerCommand("tdd-workflow-helper-test", {
    description: "Run fast unit tests for the TDD workflow helper extension",
    handler: (args, ctx) => controller.handleHelperTestCommand(args, ctx),
  });
}
