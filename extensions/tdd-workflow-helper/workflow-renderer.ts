import { Text } from "@earendil-works/pi-tui";

type WorkflowChecksMessageDetails = {
  userFeedback?: string;
};

export function workflowChecksMessageText(message: { content?: unknown; details?: unknown }, expanded?: boolean): string {
  const details = message.details as WorkflowChecksMessageDetails | undefined;
  const content = typeof message.content === "string" ? message.content : "";
  const expandedContent = typeof details?.userFeedback === "string" ? details.userFeedback : content;
  return expanded ? expandedContent : content;
}

export function renderWorkflowChecksMessage(message: { content?: unknown; details?: unknown }, expanded?: boolean): Text {
  return new Text(workflowChecksMessageText(message, expanded), 0, 0);
}
