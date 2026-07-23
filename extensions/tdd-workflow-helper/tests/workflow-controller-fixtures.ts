import type { WorkflowCheckFeedback } from "../checks";
import type { WorkflowControllerDependencies } from "../workflow-controller";
import type { ProjectTestSettings } from "../types";

export function controllerDeps({
  settings,
  onRunChecks,
  selfTestResult = "self-tests passed",
}: {
  settings: ProjectTestSettings | undefined;
  onRunChecks?: () => void;
  selfTestResult?: string;
}): WorkflowControllerDependencies {
  return {
    loadProjectTestSettings: async () => settings,
    runWorkflowChecks: async () => {
      onRunChecks?.();
      return workflowFeedback();
    },
    runSelfTests: async () => selfTestResult,
  };
}

export function workflowFeedback(): WorkflowCheckFeedback {
  return {
    summaryFeedback: "summary feedback",
    llmFeedback: "llm feedback",
    userFeedback: "user feedback",
  };
}

export function mutationResult(toolName: string): { toolName: string; isError: boolean; content: Array<{ type: string; text: string }>; details: Record<string, unknown> } {
  return { toolName, isError: false, content: [{ type: "text", text: "done" }], details: {} };
}
