import type { ProjectTestSettings } from "../types";

export type FakeExecResult = {
  code: number;
  killed: boolean;
  stdout: string;
  stderr: string;
};

export type FakeExecCall = {
  command: string;
  args: string[];
};

export function execResult(overrides: Partial<FakeExecResult> & { commandOutput?: string } = {}): FakeExecResult {
  return {
    code: overrides.code ?? 0,
    killed: overrides.killed ?? false,
    stdout: overrides.stdout ?? overrides.commandOutput ?? "",
    stderr: overrides.stderr ?? "",
  };
}

export function createFakePi(results: FakeExecResult[]): { pi: { exec(command: string, args: string[]): Promise<FakeExecResult> }; calls: FakeExecCall[] } {
  const calls: FakeExecCall[] = [];
  return {
    calls,
    pi: {
      exec: async (command: string, args: string[]) => {
        calls.push({ command, args });
        return results.shift() ?? execResult();
      },
    },
  };
}

export function createFakeContext(cwd: string, options: { hasUI?: boolean; confirmResult?: boolean } = {}) {
  const statuses: Array<{ key: string; value: string }> = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const confirmations: Array<{ title: string; message: string }> = [];
  return {
    cwd,
    hasUI: options.hasUI ?? true,
    signal: undefined,
    statuses,
    notifications,
    confirmations,
    ui: {
      setStatus: (key: string, value: string) => statuses.push({ key, value }),
      notify: (message: string, level: string) => notifications.push({ message, level }),
      confirm: async (title: string, message: string) => {
        confirmations.push({ title, message });
        return options.confirmResult ?? true;
      },
    },
  };
}

export function createFakeExtensionPi(options: { activeTools?: string[]; execResults?: FakeExecResult[] } = {}) {
  let activeTools = [...(options.activeTools ?? [])];
  const sentMessages: Array<{ message; options? }> = [];
  const activeToolHistory: string[][] = [];
  const execFake = createFakePi(options.execResults ?? []);

  return {
    ...execFake,
    sentMessages,
    activeToolHistory,
    pi: {
      ...execFake.pi,
      getActiveTools: () => activeTools,
      setActiveTools: (tools: string[]) => {
        activeTools = [...tools];
        activeToolHistory.push([...tools]);
      },
      sendMessage: (message, messageOptions?) => sentMessages.push({ message, options: messageOptions }),
    },
    get activeTools() {
      return activeTools;
    },
  };
}

export function lastStatusValue(ctx: { statuses: Array<{ value: string }> }): string {
  return ctx.statuses[ctx.statuses.length - 1]?.value ?? "";
}

export function documentedWorkflowSettings(): ProjectTestSettings {
  return {
    checkCommands: [
      { label: "unit tests", command: "unit", args: [], timeout: 1000, kind: "test" },
      { label: "lint", command: "lint", args: [], timeout: 1000, kind: "lint" },
    ],
    isProjectRepository: () => true,
    evaluateCheck: ({ check, stdout, stderr, ok, formatCommandOutput }) => {
      if (stdout.includes("FAIL")) {
        return {
          output: "First parsed failure only, so the agent fixes one thing at a time.",
          testSummary: { passed: 0, failed: 1, skipped: 0, total: 1, msg: "parsed failure" },
          continueChecks: false,
          stopReason: "Showing details for only the first failing test.",
        };
      }
      if (stdout.includes("STOP")) {
        return {
          output: "This passed, but later checks are intentionally hidden.",
          testSummary: { passed: 1, failed: 0, skipped: 0, total: 1 },
          continueChecks: false,
          stopReason: "Project asked to stop before later checks.",
        };
      }
      return {
        output: ok ? `${check.label} accepted ${stdout}` : formatCommandOutput(stdout, stderr),
        testSummary: check.kind === "test" ? { passed: ok ? 1 : 0, failed: ok ? 0 : 1, skipped: 0, total: 1 } : undefined,
        continueChecks: ok,
      };
    },
  };
}
