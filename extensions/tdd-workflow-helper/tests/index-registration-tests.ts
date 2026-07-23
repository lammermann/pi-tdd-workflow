import registerTddWorkflowHelper from "../index";
import { createFakeRegistrationPi } from "./fake-utils";

type ExpectEqual = <T>(name: string, actual: T, expected: T) => void;

export async function runIndexRegistrationTests(expectEqual: ExpectEqual): Promise<void> {
  const fakePi = createFakeRegistrationPi();

  registerTddWorkflowHelper(fakePi.pi as never);

  expectEqual("index registers the workflow checks message renderer", fakePi.messageRenderers.has("tdd-workflow-checks"), true);
  expectEqual("index registers the session start handler", fakePi.eventHandlers.has("session_start"), true);
  expectEqual("index registers the tool call handler", fakePi.eventHandlers.has("tool_call"), true);
  expectEqual("index registers the tool result handler", fakePi.eventHandlers.has("tool_result"), true);
  expectEqual("index registers workflow toggle command", fakePi.commands.has("tdd-workflow"), true);
  expectEqual("index registers supervision command", fakePi.commands.has("tdd-workflow-supervision"), true);
  expectEqual("index registers workflow tools command", fakePi.commands.has("tdd-workflow-tools"), true);
  expectEqual("index registers manual checks command", fakePi.commands.has("tdd-workflow-checks"), true);
  expectEqual("index registers helper self-test command", fakePi.commands.has("tdd-workflow-helper-test"), true);
}
