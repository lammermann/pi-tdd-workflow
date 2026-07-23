import { WorkflowController } from "../workflow-controller";
import { createFakeContext, createFakeExtensionPi, documentedWorkflowSettings } from "./fake-utils";

type ExpectEqual = <T>(name: string, actual: T, expected: T) => void;

export async function runWorkflowControllerTests(expectEqual: ExpectEqual): Promise<void> {
  await testSessionStartEnablesRepositoryWorkflow(expectEqual);
  await testSessionStartStaysDisabledWithoutRepositorySettings(expectEqual);
  await testInvalidCommandsExplainUsage(expectEqual);
  await testWorkflowCommandRestoresTools(expectEqual);
  await testSupervisionCommandChangesGuardBehavior(expectEqual);
  await testWorkflowToolsCommandReappliesActiveToolPolicy(expectEqual);
  await testChecksCommandSendsUserAndLlmFeedback(expectEqual);
  await testHelperTestCommandSendsNextTurnResult(expectEqual);
  await testUnsupervisedGuardedMutationBlocksWithoutPrompt(expectEqual);
  await testToolCallIgnoresNonGuardedCases(expectEqual);
  await testGuardedMutationConfirmationDenialBlocks(expectEqual);
  await testSuccessfulMutationAppendsWorkflowFeedback(expectEqual);
  await testToolResultIgnoresCasesThatShouldNotRunChecks(expectEqual);
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

async function testSessionStartStaysDisabledWithoutRepositorySettings(expectEqual: ExpectEqual): Promise<void> {
  const noSettingsPi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write"] });
  const noSettingsCtx = createFakeContext("/repo");
  const noSettingsController = new WorkflowController(noSettingsPi.pi as never, {
    loadProjectTestSettings: async () => undefined,
    runWorkflowChecks: async () => workflowFeedback(),
    runSelfTests: async () => "self-tests passed",
  });

  await noSettingsController.onSessionStart(undefined, noSettingsCtx as never);

  expectEqual("session start leaves workflow off when settings are missing", noSettingsCtx.statuses.find((status) => status.key === "tdd-workflow")?.value, "workflow: off");
  expectEqual("session start does not alter active tools when workflow stays off", noSettingsPi.activeTools.join(","), "edit,bash,write");

  const nonRepoPi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write"] });
  const nonRepoCtx = createFakeContext("/repo", { hasUI: false });
  const nonRepoController = new WorkflowController(nonRepoPi.pi as never, {
    loadProjectTestSettings: async () => ({ ...documentedWorkflowSettings(), isProjectRepository: () => false }),
    runWorkflowChecks: async () => workflowFeedback(),
    runSelfTests: async () => "self-tests passed",
  });

  await nonRepoController.onSessionStart(undefined, nonRepoCtx as never);

  expectEqual("session start leaves workflow off when repository predicate rejects cwd", nonRepoCtx.statuses.find((status) => status.key === "tdd-workflow")?.value, "workflow: off");
  expectEqual("session start skips notification when UI is unavailable", nonRepoCtx.notifications.length, 0);
}

async function testInvalidCommandsExplainUsage(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, {
    loadProjectTestSettings: async () => undefined,
    runWorkflowChecks: async () => workflowFeedback(),
    runSelfTests: async () => "self-tests passed",
  });

  await controller.handleWorkflowCommand("maybe", ctx as never);
  expectEqual("invalid workflow command explains usage", ctx.notifications.at(-1)?.message, "Usage: /tdd-workflow [on|off|status]");
  expectEqual("invalid workflow command is reported as an error", ctx.notifications.at(-1)?.level, "error");

  await controller.handleSupervisionCommand("maybe", ctx as never);
  expectEqual("invalid supervision command explains usage", ctx.notifications.at(-1)?.message, "Usage: /tdd-workflow-supervision [auto|supervised|unsupervised|status]");

  await controller.handleToolsCommand("disable", ctx as never);
  expectEqual("invalid tools command explains usage", ctx.notifications.at(-1)?.message, "Usage: /tdd-workflow-tools [status|disable <tool>|enable <tool>]");
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

async function testSupervisionCommandChangesGuardBehavior(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo", { hasUI: false });
  const controller = new WorkflowController(fakePi.pi as never, {
    loadProjectTestSettings: async () => documentedWorkflowSettings(),
    runWorkflowChecks: async () => workflowFeedback(),
    runSelfTests: async () => "self-tests passed",
  });

  await controller.handleSupervisionCommand("supervised", ctx as never);
  const result = await controller.handleToolCall({ toolName: "edit", input: { path: "test/foo_test.ts" } }, ctx as never);

  expectEqual("supervision command updates status text", ctx.statuses.at(-1)?.value, "supervision: supervised");
  expectEqual("supervised mode prompts even without UI auto-detection", ctx.confirmations.length, 1);
  expectEqual("approved supervised guarded mutation is allowed", result, undefined);
}

async function testWorkflowToolsCommandReappliesActiveToolPolicy(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write", "python"] });
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, {
    loadProjectTestSettings: async () => undefined,
    runWorkflowChecks: async () => workflowFeedback(),
    runSelfTests: async () => "self-tests passed",
  });

  await controller.handleWorkflowCommand("on", ctx as never);
  await controller.handleToolsCommand("disable python", ctx as never);

  expectEqual("tools command reapplies disabled tool policy while workflow is active", fakePi.activeTools.join(","), "edit,write");
  expectEqual("tools command reports sorted disabled tools", ctx.notifications.at(-1)?.message, "Workflow-disabled tools: bash, python.");
}

async function testChecksCommandSendsUserAndLlmFeedback(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, {
    loadProjectTestSettings: async () => undefined,
    runWorkflowChecks: async () => workflowFeedback(),
    runSelfTests: async () => "self-tests passed",
  });

  await controller.handleChecksCommand("", ctx as never);

  expectEqual("checks command sends a visible summary message", fakePi.sentMessages[0]?.message.content, "summary feedback");
  expectEqual("checks command keeps full user feedback in visible message details", fakePi.sentMessages[0]?.message.details.userFeedback, "user feedback");
  expectEqual("checks command sends hidden LLM feedback", fakePi.sentMessages[1]?.message.content, "llm feedback");
}

async function testHelperTestCommandSendsNextTurnResult(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, {
    loadProjectTestSettings: async () => undefined,
    runWorkflowChecks: async () => workflowFeedback(),
    runSelfTests: async () => "self-tests passed",
  });

  await controller.handleHelperTestCommand("", ctx as never);

  expectEqual("helper test command notifies successful self-test output", ctx.notifications.at(-1)?.message, "self-tests passed");
  expectEqual("helper test command delivers visible result next turn", fakePi.sentMessages[0]?.options.deliverAs, "nextTurn");
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

async function testToolCallIgnoresNonGuardedCases(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, {
    loadProjectTestSettings: async () => documentedWorkflowSettings(),
    runWorkflowChecks: async () => workflowFeedback(),
    runSelfTests: async () => "self-tests passed",
  });

  expectEqual("tool call ignores non-mutation tools", await controller.handleToolCall({ toolName: "bash", input: { path: "test/foo_test.ts" } }, ctx as never), undefined);
  expectEqual("tool call ignores mutation tools without a target path", await controller.handleToolCall({ toolName: "edit", input: {} }, ctx as never), undefined);
  expectEqual("tool call allows unguarded implementation files", await controller.handleToolCall({ toolName: "write", input: { path: "lib/main.ts" } }, ctx as never), undefined);
  expectEqual("allowed tool calls do not prompt", ctx.confirmations.length, 0);
}

async function testGuardedMutationConfirmationDenialBlocks(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo", { confirmResult: false });
  const controller = new WorkflowController(fakePi.pi as never, {
    loadProjectTestSettings: async () => documentedWorkflowSettings(),
    runWorkflowChecks: async () => workflowFeedback(),
    runSelfTests: async () => "self-tests passed",
  });

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

async function testToolResultIgnoresCasesThatShouldNotRunChecks(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write"] });
  const ctx = createFakeContext("/repo", { hasUI: false });
  let checkRuns = 0;
  const controller = new WorkflowController(fakePi.pi as never, {
    loadProjectTestSettings: async () => undefined,
    runWorkflowChecks: async () => {
      checkRuns += 1;
      return workflowFeedback();
    },
    runSelfTests: async () => "self-tests passed",
  });

  expectEqual("tool result ignores mutation while workflow is disabled", await controller.handleToolResult(mutationResult("edit"), ctx as never), undefined);
  await controller.handleWorkflowCommand("on", ctx as never);
  expectEqual("tool result ignores non-mutation tools", await controller.handleToolResult(mutationResult("bash"), ctx as never), undefined);
  expectEqual("tool result ignores errored mutation results", await controller.handleToolResult({ ...mutationResult("edit"), isError: true }, ctx as never), undefined);
  expectEqual("ignored tool results do not run checks", checkRuns, 0);

  await controller.handleToolResult(mutationResult("write"), ctx as never);
  expectEqual("no-UI successful mutation still runs checks", checkRuns, 1);
  expectEqual("no-UI successful mutation skips user notification", ctx.notifications.some((notification) => notification.message === "user feedback"), false);
}

function mutationResult(toolName: string) {
  return { toolName, isError: false, content: [{ type: "text", text: "done" }], details: {} };
}

function workflowFeedback() {
  return {
    summaryFeedback: "summary feedback",
    llmFeedback: "llm feedback",
    userFeedback: "user feedback",
  };
}
