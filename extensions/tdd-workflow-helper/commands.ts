import type { WorkflowToggleAction, WorkflowToolAction } from "./types";

/** Parses the optional workflow toggle command argument. */
export function parseWorkflowToggleAction(args: string): WorkflowToggleAction | undefined {
  const normalized = args.trim().toLowerCase();

  if (normalized === "" || normalized === "status") {
    return "status";
  }
  if (["on", "enable", "enabled", "activate", "activated"].includes(normalized)) {
    return "on";
  }
  if (["off", "disable", "disabled", "deactivate", "deactivated"].includes(normalized)) {
    return "off";
  }

  return undefined;
}

/** Parses the workflow tool policy command argument. */
export function parseWorkflowToolCommand(args: string): { action: WorkflowToolAction; tool?: string } | undefined {
  const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (parts.length === 0 || (parts.length === 1 && parts[0] === "status")) {
    return { action: "status" };
  }

  if (parts.length !== 2) {
    return undefined;
  }

  const [rawAction, tool] = parts;
  if (["disable", "deny", "off", "remove"].includes(rawAction)) {
    return { action: "disable", tool };
  }
  if (["enable", "allow", "on", "add"].includes(rawAction)) {
    return { action: "enable", tool };
  }

  return undefined;
}

/** Formats disabled workflow tools for status messages. */
export function formatDisabledWorkflowTools(disabledTools: Set<string>): string {
  if (disabledTools.size === 0) {
    return "none";
  }

  return [...disabledTools].sort().join(", ");
}

/** Builds a concise status message for the automatic workflow. */
export function workflowStatusMessage(enabled: boolean): string {
  return `TDD workflow checks are ${enabled ? "enabled" : "disabled"}.`;
}
