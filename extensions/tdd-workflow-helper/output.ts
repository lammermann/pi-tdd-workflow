/** Maximum number of output characters included per command in the LLM-visible feedback. */
const MAX_OUTPUT_CHARS = 4000;

/** Truncates long command output while preserving the most recent lines. */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }

  return `... truncated ${output.length - MAX_OUTPUT_CHARS} chars ...\n${output.slice(-MAX_OUTPUT_CHARS)}`;
}

/** Formats complete command output for user-only display. */
export function formatFullCommandOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n") || "<no output>";
}

/** Formats command output for inclusion in a tool result. */
export function formatCommandOutput(stdout: string, stderr: string): string {
  return truncateOutput(formatFullCommandOutput(stdout, stderr));
}
