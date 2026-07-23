import { workflowChecksMessageText } from "../workflow-renderer";

type ExpectEqual = <T>(name: string, actual: T, expected: T) => void;

export async function runWorkflowRendererTests(expectEqual: ExpectEqual): Promise<void> {
  expectEqual(
    "workflow checks renderer collapsed text uses summary content",
    workflowChecksMessageText({ content: "summary", details: { userFeedback: "full user feedback" } }, false),
    "summary",
  );
  expectEqual(
    "workflow checks renderer expanded text uses full user feedback when available",
    workflowChecksMessageText({ content: "summary", details: { userFeedback: "full user feedback" } }, true),
    "full user feedback",
  );
  expectEqual(
    "workflow checks renderer expanded text falls back to summary when details are absent",
    workflowChecksMessageText({ content: "summary" }, true),
    "summary",
  );
  expectEqual(
    "workflow checks renderer treats non-string content as empty text",
    workflowChecksMessageText({ content: { not: "text" } }, false),
    "",
  );
}
