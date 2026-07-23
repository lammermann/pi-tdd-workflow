import { WorkflowController } from "../workflow-controller";
import { createFakeContext, createFakeExtensionPi, documentedWorkflowSettings } from "./fake-utils";
import { controllerDeps, mutationResult } from "./workflow-controller-fixtures";

type ExpectEqual = <T>(name: string, actual: T, expected: T) => void;

export async function runWorkflowControllerToolTests(expectEqual: ExpectEqual): Promise<void> {
  await testUnsupervisedGuardedMutationBlocksWithoutPrompt(expectEqual);
  await testToolCallIgnoresNonGuardedCases(expectEqual);
  await testGuardedMutationConfirmationDenialBlocks(expectEqual);
  await testSuccessfulMutationAppendsWorkflowFeedback(expectEqual);
  await testToolResultIgnoresCasesThatShouldNotRunChecks(expectEqual);
}

async function testUnsupervisedGuardedMutationBlocksWithoutPrompt(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo", { hasUI: false });
  const controller = new WorkflowController(fakePi.pi as never, controllerDeps({ settings: documentedWorkflowSettings() }));

  const result = await controller.handleToolCall({ toolName: "edit", input: { path: "test/foo_test.ts" } }, ctx as never);

  expectEqual("unsupervised guarded test mutations are blocked", result?.block, true);
  expectEqual("unsupervised guarded test mutations do not prompt", ctx.confirmations.length, 0);
  expectEqual("guarded test mutation rejection tells the agent to implement instead", result?.reason.startsWith("Modification of tests rejected."), true);
}

async function testToolCallIgnoresNonGuardedCases(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, controllerDeps({ settings: documentedWorkflowSettings() }));

  expectEqual("tool call ignores non-mutation tools", await controller.handleToolCall({ toolName: "bash", input: { path: "test/foo_test.ts" } }, ctx as never), undefined);
  expectEqual("tool call ignores mutation tools without a target path", await controller.handleToolCall({ toolName: "edit", input: {} }, ctx as never), undefined);
  expectEqual("tool call allows unguarded implementation files", await controller.handleToolCall({ toolName: "write", input: { path: "lib/main.ts" } }, ctx as never), undefined);
  expectEqual("allowed tool calls do not prompt", ctx.confirmations.length, 0);
}

async function testGuardedMutationConfirmationDenialBlocks(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo", { confirmResult: false });
  const controller = new WorkflowController(fakePi.pi as never, controllerDeps({ settings: documentedWorkflowSettings() }));

  const testFileResult = await controller.handleToolCall({ toolName: "edit", input: { path: "test/foo_test.ts" } }, ctx as never);
  expectEqual("supervised denial blocks guarded test mutation", testFileResult?.block, true);
  expectEqual("supervised denial prompts before blocking", ctx.confirmations.length, 1);

  const noUiCtx = createFakeContext("/repo", { hasUI: false });
  const outsideResult = await controller.handleToolCall({ toolName: "write", input: { path: "/tmp/outside.txt" } }, noUiCtx as never);
  expectEqual("unsupervised outside-project mutation is blocked", outsideResult?.block, true);
  expectEqual("outside-project rejection forbids retrying", outsideResult?.reason, "Modifications outside the project are not permitted. Do not try it again.");
}

async function testSuccessfulMutationAppendsWorkflowFeedback(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write"] });
  const ctx = createFakeContext("/repo");
  let checkRuns = 0;
  const controller = new WorkflowController(fakePi.pi as never, controllerDeps({ settings: documentedWorkflowSettings(), onRunChecks: () => (checkRuns += 1) }));

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

async function testToolResultIgnoresCasesThatShouldNotRunChecks(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write"] });
  const ctx = createFakeContext("/repo", { hasUI: false });
  let checkRuns = 0;
  const controller = new WorkflowController(fakePi.pi as never, controllerDeps({ settings: undefined, onRunChecks: () => (checkRuns += 1) }));

  expectEqual("tool result ignores mutation while workflow is disabled", await controller.handleToolResult(mutationResult("edit"), ctx as never), undefined);
  await controller.handleWorkflowCommand("on", ctx as never);
  expectEqual("tool result ignores non-mutation tools", await controller.handleToolResult(mutationResult("bash"), ctx as never), undefined);
  expectEqual("tool result ignores errored mutation results", await controller.handleToolResult({ ...mutationResult("edit"), isError: true }, ctx as never), undefined);
  expectEqual("ignored tool results do not run checks", checkRuns, 0);

  await controller.handleToolResult(mutationResult("write"), ctx as never);
  expectEqual("no-UI successful mutation still runs checks", checkRuns, 1);
  expectEqual("no-UI successful mutation skips user notification", ctx.notifications.some((notification) => notification.message === "user feedback"), false);
}
