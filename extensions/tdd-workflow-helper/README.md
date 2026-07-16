# TDD Workflow Helper

Reusable pi extension for a strict TDD workflow.

The helper is project-language agnostic. It does not know about Flutter, Dart,
Node.js, Python, Rust, Go, or any other language by default. Instead, each
project provides `.pi/project-test-settings.ts` to adapt the workflow to its own
language, toolchain, test runner, framework, output format, and repository
detection rules.

The helper can:

- run project-defined checks in order after successful `edit`/`write` tool calls, stopping at the first failing check,
- block or confirm guarded edits outside the project or inside top-level `test/` / `tests/` folders,
- reject restricted `edit`/`write` calls when pi is running without an interactive supervisor,
- create a new `jj` change after successful test feedback.
- auto-enable itself for matching projects,
- temporarily disable selected tools while the workflow is active,

## Commands

```text
/tdd-workflow [on|off|status]
/tdd-workflow-supervision [auto|supervised|unsupervised|status]
/tdd-workflow-tools [status|disable <tool>|enable <tool>]
/tdd-workflow-checks
/tdd-workflow-helper-test
```

## Extension layout

Install or copy the whole directory, not only `index.ts`:

```text
tdd-workflow-helper/
  index.ts
  checks.ts
  commands.ts
  jj.ts
  mutation-guard.ts
  output.ts
  project-settings.ts
  types.ts
  tests/
    self-tests.ts
```

## Project customization

Each project customizes the extension with a project-relative settings file. Use
this file to make the generic workflow work with any language, toolchain, or
framework:

```text
.pi/project-test-settings.ts
```

The extension always resolves this path from the active project root (`ctx.cwd`), so the extension may live inside the project or in a global/user extension directory such as `~/.pi/extensions`.

### Supervision mode

Use this before handing off an interactive session:

```text
/tdd-workflow-supervision unsupervised
```

While in `unsupervised` mode, normal implementation edits can continue, but guarded paths are rejected instead of prompting for confirmation. Switch back with `/tdd-workflow-supervision supervised` or `/tdd-workflow-supervision auto`.

### Minimal example

A fuller Flutter example is available at:

```text
examples/flutter/project-test-settings.ts
```

Copy it to your project's `.pi/project-test-settings.ts` and adjust the test
target. The same settings mechanism can be used for any other stack by changing
the commands and output parsing.

```ts
import type { ProjectTestSettings } from "./workflow-helper-api";

const projectTestSettings: ProjectTestSettings = {
  checkCommands: [
    {
      label: "npm test",
      command: "npm",
      args: ["test"],
      timeout: 120_000,
      kind: "test",
    },
  ],

  isProjectRepository: (cwd) => cwd.length > 0,

  evaluateCheck: ({ stdout, stderr, ok, formatCommandOutput }) => ({
    output: formatCommandOutput(stdout, stderr),
    continueChecks: ok,
  }),
};

export default projectTestSettings;
```

### Type helper file

For local type safety, create:

```text
.pi/workflow-helper-api.ts
```

and export the project settings contract from there. This repository already contains such a file. New projects can copy it and then import:

```ts
import type { ProjectTestSettings } from "./workflow-helper-api";
```

The extension intentionally does not statically import this project-local file, because the extension can be installed outside the project.

### Required settings shape

`ProjectTestSettings` provides:

- `checkCommands`: ordered commands to run. Later commands are hidden until earlier commands pass.
- `guardedPaths?`: additional project-relative glob patterns that require confirmation in supervised mode and are rejected in unsupervised mode.
- `isProjectRepository(cwd)`: auto-enable predicate for the current project.
- `evaluateCheck(...)`: converts command results into user-facing output and can explicitly stop later checks with `continueChecks: false`.
- `runSelfTests?()`: optional project-specific self-tests run by `/tdd-workflow-helper-test`.

## Notes for future extraction

The project-local `.pi/workflow-helper-api.ts` should eventually move to a shared package, for example `@your-org/pi-workflow-helper-api`. Then every project settings file and this extension can import the same type contract from that package instead of keeping structural mirrors.
