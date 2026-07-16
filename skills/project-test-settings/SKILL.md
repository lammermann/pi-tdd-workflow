---
name: project-test-settings
description: Creates or updates .pi/project-test-settings.ts and .pi/workflow-helper-api.ts for the TDD workflow helper. Use when configuring workflow checks, test/lint/analyze commands, ordered validation, guarded paths, repository detection, or project-specific output parsing.
---

# Project Test Settings

Use this skill to create or update project-local settings for the `tdd-workflow-helper` extension.

The goal is to make automatic feedback useful and incremental: commands in `.pi/project-test-settings.ts` should run in order, and later commands should stay hidden until earlier checks pass. Within test commands, projects may also choose to reveal only the first failing test so the agent fixes failures one at a time. Put fast, high-signal checks first; put slower lint/analyze/architecture checks later.

## Target files

- `.pi/project-test-settings.ts`: project-specific workflow configuration.
- `.pi/workflow-helper-api.ts`: local type mirror for editor/type safety. Create it when missing.
- Optional documentation such as `README.md` only when the project already documents local tooling.

## Workflow

1. Inspect the project structure and existing settings.
   - Read `.pi/project-test-settings.ts` if it exists.
   - Read `.pi/workflow-helper-api.ts` if it exists.
   - Inspect package/tooling files such as `package.json`, `pubspec.yaml`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Makefile`, or CI configuration.
   - Inspect existing test directories only enough to identify stable entrypoints; do not rewrite tests.

2. Discuss project preferences before choosing disclosure behavior.
   - Briefly explain the available context-control choices and ask which style the project prefers when it is not obvious:
     - command-level only: reveal the first failing command, but show all failures from that command,
     - first failing test: parse test output and show only one failure from the current test command,
     - fail-fast runner: configure the test runner to stop after the first failure when supported,
     - curated suites: split checks into smaller ordered commands instead of parsing individual failures.
   - Mention the tradeoff: stricter progressive disclosure reduces context pollution and encourages focused fixes, while showing more failures can expose shared root causes and reduce repeated edit/check cycles.
   - Prefer the simplest behavior that matches the project culture and test runner capabilities.

3. Choose ordered checks.
   - Prefer this order:
     1. cheap sanity checks, e.g. conflict markers or generated-file checks,
     2. focused tests used for the current TDD loop,
     3. broader tests,
     4. formatting checks,
     5. lint/static analysis,
     6. architecture or policy checks.
   - Keep early checks fast and deterministic.
   - Each command should have a clear `label`, `command`, `args`, `timeout`, and optional `kind`.
   - Later checks should only run when earlier checks pass.

4. Implement or update `.pi/workflow-helper-api.ts` when needed.
   - Keep it structurally compatible with the extension contract:
     - `CheckCommand`
     - `WorkflowTestSummary`
     - `CheckEvaluation`
     - `ProjectTestSettings`
   - Document that `checkCommands` are ordered and hidden until previous checks pass.

5. Implement or update `.pi/project-test-settings.ts`.
   - Export a default `ProjectTestSettings` object.
   - Define `CHECK_COMMANDS` as an ordered array.
   - Implement `isProjectRepository(cwd)` using stable marker files so the workflow auto-enables only in the intended project.
   - Implement `evaluateCheck(...)` to return concise output for the agent.
   - For real test commands, parse machine-readable output when available and return `testSummary`.
   - If the project chooses first-failing-test disclosure, parse the full test output, return details for only the first current failure, and include a compact list of hidden failure identities; keep the full failure count in `testSummary`.
   - Return `continueChecks: false` with a clear `stopReason` when a command passes technically but its parsed result is not good enough to proceed.
   - Add `guardedPaths` for project-specific files the agent should not modify freely, e.g. nested extension tests, golden files, migrations, or generated contracts.
   - Add `runSelfTests()` for parser and repository-detection logic.

6. Validate through automatic feedback.
   - If the TDD workflow helper reports results automatically after edits, use those results and do not run duplicate commands manually.
   - If no automatic feedback is available, ask before running project checks manually.

## Recommended settings shape

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CheckCommand,
  ProjectTestSettings,
  WorkflowTestSummary,
} from "./workflow-helper-api";

const CHECK_COMMANDS: CheckCommand[] = [
  {
    label: "conflict marker check",
    command: "sh",
    args: ["-c", "! grep -R --exclude-dir=.git --exclude-dir=.jj --exclude-dir=.pi -n -E '^(<<<<<<<|=======|>>>>>>>)' ."],
    timeout: 30_000,
  },
  {
    label: "focused tests",
    command: "npm",
    args: ["test", "--", "--runInBand"],
    timeout: 120_000,
    kind: "test",
  },
  {
    label: "lint",
    command: "npm",
    args: ["run", "lint"],
    timeout: 120_000,
    kind: "lint",
  },
];

function isProjectRepository(cwd: string): boolean {
  return existsSync(join(cwd, "package.json"));
}

function basicSummary(ok: boolean, msg = ""): WorkflowTestSummary {
  return { passed: ok ? 1 : 0, failed: ok ? 0 : 1, skipped: 0, total: 1, msg };
}

const projectTestSettings: ProjectTestSettings = {
  checkCommands: CHECK_COMMANDS,
  guardedPaths: [],
  isProjectRepository,
  evaluateCheck: ({ check, stdout, stderr, ok, formatCommandOutput }) => {
    const output = ok ? `${check.label} passed.` : formatCommandOutput(stdout, stderr);
    const testSummary = check.kind === "test" ? basicSummary(ok) : undefined;
    return {
      output,
      testSummary,
      continueChecks: ok && (testSummary?.failed ?? 0) === 0,
      stopReason: ok ? undefined : `Stopping before later checks because ${check.label} failed.`,
    };
  },
  runSelfTests: () => "Project test settings self-tests passed (1 assertion).",
};

export default projectTestSettings;
```

## Output parsing guidance

- Prefer JSON, JUnit XML, TAP, or other stable machine-readable formats over scraping console text.
- Keep LLM-facing `output` concise; include raw details only on failure via `formatCommandOutput(stdout, stderr)`.
- `WorkflowTestSummary.failed > 0` stops later checks.
- `continueChecks: false` also stops later checks, even if the command exit code was zero.
- Use `stopReason` to tell the agent why later feedback is intentionally hidden.

## First failing test disclosure

When a test command can produce many failures, prefer revealing details for only the first currently failing test in `evaluateCheck(...)`, while still showing a compact identity list for the other hidden failures.

Recommended stateless pattern:

1. Run the normal test command, preferably with machine-readable output.
2. Parse all failures to compute an accurate `testSummary`.
3. Return detailed output for only the first current failure.
4. Include stable identifiers/names for other hidden failures, without stack traces or large diffs.
5. Return `continueChecks: false` while any failure remains.
6. Use a `stopReason` such as `Showing details for only the first failing test. Fix it before later failure details are shown.`

This does not require persistent state. After the first failure is fixed, the next run naturally reveals details for the next current failure. If an earlier failure regresses, it will reappear as the first current failure; stable failure IDs and the compact hidden-failure list help the agent recognize that connection.

Conceptual example:

```ts
if (check.kind === "test") {
  const result = parseTestOutput(stdout, stderr);
  const firstFailure = result.failures[0];

  return {
    output: firstFailure === undefined
      ? "All focused tests passed."
      : formatProgressiveFailures(firstFailure, result.failures.slice(1)),
    testSummary: result.summary,
    continueChecks: ok && result.summary.failed === 0,
    stopReason: firstFailure === undefined
      ? undefined
      : "Showing details for only the first failing test. Fix it before later failure details are shown.",
  };
}
```

The preferred output shape is:

```text
3 tests failing. Showing details for the first failure only.

Visible failure:
- id: user-repository/does-not-save-duplicates
- file: test/user_repository_test.dart
- name: UserRepository does not save duplicates

<focused assertion message, diff, and relevant stack for this one failure>

Hidden failures:
- user-repository/updates-existing-users — UserRepository updates existing users
- order-service/rejects-invalid-orders — OrderService rejects invalid orders
```

Discuss these tradeoffs with the user before adopting this pattern:

- **First failing test details plus compact hidden list** keeps detailed context small, supports strict TDD, and still gives enough global awareness to spot related failures or regressions; it requires stable parser output and concise formatting.
- **Showing all failures in a command** is simpler and may reveal patterns, but can pollute context and tempt broad unfocused fixes.
- **Test runner fail-fast flags** are very simple when available, but may reduce summary accuracy and may stop at the first file/suite rather than the first assertion.
- **Curated ordered test commands** avoid parsing and are reliable, but require maintaining stable test entrypoints and may still show multiple failures inside one command.
- **Stateful “next failure” tracking** can reveal additional failures while earlier ones remain, but needs stable failure IDs, storage, invalidation rules, and can undermine strict red/green focus. Avoid unless the project explicitly wants it.

## Common command ordering examples

### JavaScript / TypeScript

1. conflict marker check
2. focused test command (`npm test`, `vitest run`, `jest --runInBand`, etc.)
3. typecheck (`npm run typecheck`)
4. lint (`npm run lint`)
5. architecture checks (`npm run depcruise`, custom scripts)

### Flutter / Dart

1. conflict marker check
2. focused `flutter test --reporter json <target>`
3. `dart format --set-exit-if-changed .`
4. `dart analyze`

### Python

1. conflict marker check
2. focused `pytest` command, preferably with machine-readable/plugin output if available
3. typecheck (`mypy`, `pyright`)
4. lint (`ruff check`, `flake8`)
5. format check (`ruff format --check`, `black --check`)

## Anti-patterns

- Do not put slow global lint or architecture checks before focused tests.
- Do not expose every command's output at once; ordered checks are meant to reduce context pollution.
- Do not parse brittle progress text when a machine-readable reporter is available.
- Do not auto-enable settings with a weak repository predicate such as `cwd.length > 0` unless this is an example only.
- Do not hide useful failure details from the user-visible output.
- Do not reveal large stack traces/diffs for every hidden test failure when first-failure disclosure was chosen; list hidden failure identities only.
