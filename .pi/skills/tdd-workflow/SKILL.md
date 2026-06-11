---
name: tdd-workflow
description: Guides a strict test-driven development workflow for code changes. Use when implementing features or bug fixes.
---

# TDD Workflow

Use this skill to drive implementation with a strict red-green-refactor loop.

## Core Rules

- Start by understanding the requested behavior and the relevant existing code.
- Prefer the smallest meaningful test that captures the next behavior or bug.
- Do not implement production behavior before a failing test exists, unless the user explicitly asks to skip TDD.
- Keep each cycle small: one failing test, one minimal implementation, one refactor pass.
- Do not run test, lint, analyze, or format commands directly when an automatic workflow is expected to report results after file changes.
- Use the automatically reported results as the source of truth for red/green feedback.
- Preserve existing project conventions, architecture, lint rules, and documentation requirements.

## Workflow

1. **Clarify the target behavior**
   - Restate the expected behavior briefly.
   - Identify edge cases, regressions, and acceptance criteria.
   - Ask one concise clarification question only if the behavior is ambiguous enough to block testing.

2. **Find the test location**
   - Inspect nearby implementation and existing tests.
   - Choose the closest existing test file when possible.
   - Create a new test file only when no suitable test location exists.

3. **Red: write a failing test**
   - Add the smallest test that should fail for the current code.
   - Wait for or inspect the automatically reported result after the file change.
   - Confirm the failure is for the expected reason, not a setup or syntax issue.

4. **Green: implement the minimum fix**
   - Change only the production code needed to satisfy the failing test.
   - Avoid broad refactors, unrelated cleanup, or speculative abstractions.
   - Wait for or inspect the automatically reported result and confirm the test passes.
   - If the test still fails after a few focused attempts, stop patching the broad behavior directly and decompose the problem.
   - Identify the smallest helper function that would make the broad implementation straightforward.
   - Write focused unit tests for that helper first, then implement the helper, then return to the broader failing test.
   - Apply this recursively: if the helper is still hard to implement, decompose it into smaller tested helpers until each helper is trivial.

5. **Refactor safely**
   - Improve names, structure, comments, or duplication only while tests are green.
   - Wait for or inspect the automatically reported result after refactoring.

6. **Broaden verification**
   - Rely on the automatic workflow for test, lint, analyze, and format feedback.
   - If broader verification is needed but not reported automatically, ask the user before running commands manually.

7. **Report concisely**
   - Summarize tests added or changed.
   - Summarize production changes.
   - List commands run and their results.

## Recursive Helper Extraction

Use recursive helper extraction when the green phase is not converging quickly.

1. Pause the broad implementation after a few unsuccessful minimal attempts.
2. Name the missing helper behavior in plain language.
3. Add focused unit tests for that helper's inputs, outputs, and edge cases.
4. Implement only enough helper code to satisfy those helper tests.
5. Refactor the broad implementation to use the helper.
6. Repeat the same process for any helper that is still non-trivial.

Prefer pure, deterministic helpers when possible. Keep helper APIs small and shaped by the tests rather than by speculative future needs.

## Automatic Feedback

When an automatic workflow reports validation results after file edits, do not invoke commands manually. Instead:

- Make the smallest file change for the current TDD step.
- Wait for or inspect the reported result.
- Continue the red-green-refactor loop based on that result.
- Ask the user instead of manually running any command that the automatic feedback did not cover.

## Anti-Patterns to Avoid

- Manually running commands when automatic validation feedback is already available.
- Writing production code and tests in the same first step without first observing a failing test.
- Adding large snapshots or brittle implementation-detail assertions when behavior assertions are possible.
- Mocking the system under test instead of its external dependencies.
- Leaving skipped tests, debug prints, or temporary helpers behind.
- Expanding scope beyond the requested behavior.
