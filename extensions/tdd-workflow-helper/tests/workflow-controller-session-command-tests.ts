import { WorkflowController } from "../workflow-controller";
import { createFakeContext, createFakeExtensionPi, documentedWorkflowSettings } from "./fake-utils";
import { controllerDeps } from "./workflow-controller-fixtures";

type ExpectEqual = <T>(name: string, actual: T, expected: T) => void;

export async function runWorkflowControllerSessionAndCommandTests(expectEqual: ExpectEqual): Promise<void> {
  await testSessionStartEnablesRepositoryWorkflow(expectEqual);
  await testSessionStartStaysDisabledWithoutRepositorySettings(expectEqual);
  await testInvalidCommandsExplainUsage(expectEqual);
  await testWorkflowCommandRestoresTools(expectEqual);
  await testSupervisionCommandChangesGuardBehavior(expectEqual);
  await testWorkflowToolsCommandReappliesActiveToolPolicy(expectEqual);
  await testChecksCommandSendsUserAndLlmFeedback(expectEqual);
  await testHelperTestCommandSendsNextTurnResult(expectEqual);
}

async function testSessionStartEnablesRepositoryWorkflow(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write"] });
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, controllerDeps({ settings: documentedWorkflowSettings() }));

  await controller.onSessionStart(undefined, ctx as never);

  expectEqual("controller enables workflow for recognized repositories", ctx.statuses.find((status) => status.key === "tdd-workflow")?.value, "workflow: on");
  expectEqual("controller applies the default active-tool policy on session start", fakePi.activeTools.join(","), "edit,write");
  expectEqual("controller announces active workflow when UI is available", ctx.notifications.at(-1)?.message, "TDD workflow helper loaded: write/edit tools will trigger checks.");
}

async function testSessionStartStaysDisabledWithoutRepositorySettings(expectEqual: ExpectEqual): Promise<void> {
  const noSettingsPi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write"] });
  const noSettingsCtx = createFakeContext("/repo");
  const noSettingsController = new WorkflowController(noSettingsPi.pi as never, controllerDeps({ settings: undefined }));

  await noSettingsController.onSessionStart(undefined, noSettingsCtx as never);

  expectEqual("session start leaves workflow off when settings are missing", noSettingsCtx.statuses.find((status) => status.key === "tdd-workflow")?.value, "workflow: off");
  expectEqual("session start does not alter active tools when workflow stays off", noSettingsPi.activeTools.join(","), "edit,bash,write");

  const nonRepoPi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write"] });
  const nonRepoCtx = createFakeContext("/repo", { hasUI: false });
  const nonRepoController = new WorkflowController(
    nonRepoPi.pi as never,
    controllerDeps({ settings: { ...documentedWorkflowSettings(), isProjectRepository: () => false } }),
  );

  await nonRepoController.onSessionStart(undefined, nonRepoCtx as never);

  expectEqual("session start leaves workflow off when repository predicate rejects cwd", nonRepoCtx.statuses.find((status) => status.key === "tdd-workflow")?.value, "workflow: off");
  expectEqual("session start skips notification when UI is unavailable", nonRepoCtx.notifications.length, 0);
}

async function testInvalidCommandsExplainUsage(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, controllerDeps({ settings: undefined }));

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
  const controller = new WorkflowController(fakePi.pi as never, controllerDeps({ settings: undefined }));

  await controller.handleWorkflowCommand("on", ctx as never);
  expectEqual("workflow command on disables configured tools", fakePi.activeTools.join(","), "edit,write");

  await controller.handleWorkflowCommand("off", ctx as never);
  expectEqual("workflow command off restores tools captured before workflow activation", fakePi.activeTools.join(","), "edit,bash,write");
}

async function testSupervisionCommandChangesGuardBehavior(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo", { hasUI: false });
  const controller = new WorkflowController(fakePi.pi as never, controllerDeps({ settings: documentedWorkflowSettings() }));

  await controller.handleSupervisionCommand("supervised", ctx as never);
  const result = await controller.handleToolCall({ toolName: "edit", input: { path: "test/foo_test.ts" } }, ctx as never);

  expectEqual("supervision command updates status text", ctx.statuses.at(-1)?.value, "supervision: supervised");
  expectEqual("supervised mode prompts even without UI auto-detection", ctx.confirmations.length, 1);
  expectEqual("approved supervised guarded mutation is allowed", result, undefined);
}

async function testWorkflowToolsCommandReappliesActiveToolPolicy(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi({ activeTools: ["edit", "bash", "write", "python"] });
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, controllerDeps({ settings: undefined }));

  await controller.handleWorkflowCommand("on", ctx as never);
  await controller.handleToolsCommand("disable python", ctx as never);

  expectEqual("tools command reapplies disabled tool policy while workflow is active", fakePi.activeTools.join(","), "edit,write");
  expectEqual("tools command reports sorted disabled tools", ctx.notifications.at(-1)?.message, "Workflow-disabled tools: bash, python.");
}

async function testChecksCommandSendsUserAndLlmFeedback(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, controllerDeps({ settings: undefined }));

  await controller.handleChecksCommand("", ctx as never);

  expectEqual("checks command sends a visible summary message", fakePi.sentMessages[0]?.message.content, "summary feedback");
  expectEqual("checks command keeps full user feedback in visible message details", fakePi.sentMessages[0]?.message.details.userFeedback, "user feedback");
  expectEqual("checks command sends hidden LLM feedback", fakePi.sentMessages[1]?.message.content, "llm feedback");
}

async function testHelperTestCommandSendsNextTurnResult(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeExtensionPi();
  const ctx = createFakeContext("/repo");
  const controller = new WorkflowController(fakePi.pi as never, controllerDeps({ settings: undefined }));

  await controller.handleHelperTestCommand("", ctx as never);

  expectEqual("helper test command notifies successful self-test output", ctx.notifications.at(-1)?.message, "self-tests passed");
  expectEqual("helper test command delivers visible result next turn", fakePi.sentMessages[0]?.options.deliverAs, "nextTurn");
}
