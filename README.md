# pi-tdd-workflow-helper

Pi package that bundles:

- the `tdd-workflow-helper` extension,
- the `tdd-workflow` skill.

The extension is language agnostic. Add `.pi/project-test-settings.ts` to each
project to adapt the workflow to that project's language, toolchain, framework,
test runner, and output format.

## Install locally

From the repository root:

```bash
pi install ./.pi/packages/tdd-workflow-helper
```

To install it for only the current project settings, use:

```bash
pi install -l ./.pi/packages/tdd-workflow-helper
```

## Contents

The package owns the source files so there is one source of truth during
development:

```text
extensions/tdd-workflow-helper/
  index.ts
  README.md
  examples/flutter/project-test-settings.ts
  tests/self-tests.ts
skills/tdd-workflow/
  SKILL.md
```

The repository-local development paths link back into this package:

```text
.pi/extensions/tdd-workflow-helper -> ../packages/tdd-workflow-helper/extensions/tdd-workflow-helper
.pi/skills/tdd-workflow -> ../packages/tdd-workflow-helper/skills/tdd-workflow
```

## Commands

```text
/tdd-workflow [on|off|status]
/tdd-workflow-supervision [auto|supervised|unsupervised|status]
/tdd-workflow-tools [status|disable <tool>|enable <tool>]
/tdd-workflow-checks
/tdd-workflow-helper-test
```
