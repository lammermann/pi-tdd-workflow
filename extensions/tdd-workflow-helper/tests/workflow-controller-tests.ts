import { WorkflowController } from "../workflow-controller";
import { createFakeContext, createFakeExtensionPi, documentedWorkflowSettings } from "./fake-utils";

type ExpectEqual = <T>(name: string, actual: T, expected: T) => void;

export async function runWorkflowControllerTests(expectEqual: ExpectEqual): Promise<void> {
  await testSessionStartEnablesRepositoryWorkflow(expectEqual);
  await testWorkflowCommandRestoresTools(expectEqual);
  await testUnsupervisedGuardedMutationBlocksWithoutPrompt(expectEqual);
  await testSuccessfulMutationAppendsWorkflowFeedback(expectEqual);
}

async function testSessionStartEnablesRepositoryWorkflow(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write"] });
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, {
    loadProjectTestSettings: async () => documentedWorkflowSettings(),
    runWorkflowChecks: async () => workflowFeedback(),
    runSelfTests: async () => "self-tests passed",
  });

  await controller.onSessionStart(undefined, ctx as never);

  expectEqual("controller enables workflow for recognized repositories", ctx.statuses.find((status) => status.key === "tdd-workflow")?.value, "workflow: on");
  expectEqual("controller applies the default active-tool policy on session start", fakePi.activeTools.join(","), "edit,write");
  expectEqual("controller announces active workflow when UI is available", ctx.notifications.at(-1)?.message, "TDD workflow helper loaded: write/edit tools will trigger checks.");
}

async function testWorkflowCommandRestoresTools(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write"] });
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, {
    loadProjectTestSettings: async () => undefined,
    runWorkflowChecks: async () => workflowFeedback(),
    runSelfTests: async () => "self-tests passed",
  });

  await controller.handleWorkflowCommand("on", ctx as never);
  expectEqual("workflow command on disables configured tools", fakePi.activeTools.join(","), "edit,write");

  await controller.handleWorkflowCommand("off", ctx as never);
  expectEqual("workflow command off restores tools captured before workflow activation", fakePi.activeTools.join(","), "edit,bash,write");
}

async function testUnsupervisedGuardedMutationBlocksWithoutPrompt(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo", { hasUI: false });
  const controller = new WorkflowController(fakePi.pi as never, {
    loadProjectTestSettings: async () => documentedWorkflowSettings(),
    runWorkflowChecks: async () => workflowFeedback(),
    runSelfTests: async () => "self-tests passed",
  });

  const result = await controller.handleToolCall({ toolName: "edit", input: { path: "test/foo_test.ts" } }, ctx as never);

  expectEqual("unsupervised guarded test mutations are blocked", result?.block, true);
  expectEqual("unsupervised guarded test mutations do not prompt", ctx.confirmations.length, 0);
  expectEqual("guarded test mutation rejection tells the agent to implement instead", result?.reason.startsWith("Modification of tests rejected."), true);
}

async function testSuccessfulMutationAppendsWorkflowFeedback(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write"] });
  const ctx = createFakeContext("/repo");
  let checkRuns = 0;
  const controller = new WorkflowController(fakePi.pi as never, {
    loadProjectTestSettings: async () => documentedWorkflowSettings(),
    runWorkflowChecks: async () => {
      checkRuns += 1;
      return workflowFeedback();
    },
    runSelfTests: async () => "self-tests passed",
  });

  await controller.handleWorkflowCommand("on", ctx as never);
  const result = await controller.handleToolResult(
    { toolName: "edit", isError: false, content: [{ type: "text", text: "edit completed" }], details: { original: true } },
    ctx as never,
  );

  expectEqual("successful mutation runs workflow checks when workflow is enabled", checkRuns, 1);
  expectEqual("successful mutation appends workflow feedback to tool content", result?.content.at(-1)?.text, "llm feedback");
  expectEqual("successful mutation stores workflow feedback in details", result?.details.tddWorkflowChecks, "llm feedback");
  expectEqual("successful mutation notifies UI with full feedback", ctx.notifications.at(-1)?.message, "user feedback");
}

function workflowFeedback() {
  return {
    summaryFeedback: "summary feedback",
    llmFeedback: "llm feedback",
    userFeedback: "user feedback",
  };
}
