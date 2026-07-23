import { runWorkflowControllerSessionAndCommandTests } from "./workflow-controller-session-command-tests";
import { runWorkflowControllerToolTests } from "./workflow-controller-tool-tests";

type ExpectEqual = <T>(name: string, actual: T, expected: T) => void;

export async function runWorkflowControllerTests(expectEqual: ExpectEqual): Promise<void> {
  await runWorkflowControllerSessionAndCommandTests(expectEqual);
  await runWorkflowControllerToolTests(expectEqual);
}
