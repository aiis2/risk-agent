# Portable Package-Manager Test Design

**Issue:** https://github.com/aiis2/risk-agent/issues/1

## Context

The `package_manager_write` coverage in
`packages/core/src/tools/__tests__/DeveloperProbeTools.spec.ts` resolves the
literal path `D:/npm_work/risk_agent`. The production helper then reads
`package.json` from that path. A clean checkout on any machine without that
directory fails with `ENOENT` before the test reaches its sandbox-policy and
command assertions.

The test should own every filesystem precondition it needs. It should not
depend on a developer workstation, the repository root, or mutable runtime
data.

## Goals

- Make the test portable across checkout paths and operating systems.
- Keep coverage on the real manifest and lockfile detection path.
- Ensure temporary files are removed even when the test fails.
- Avoid changing production behavior or public APIs.

## Non-Goals

- Changing package-manager command construction.
- Replacing the existing sandbox-runtime test doubles.
- Solving native dependency installation failures in the wider test suite.
- Adding a general-purpose fixture framework for a single test.

## Options Considered

### 1. Per-test temporary workspace

Create a unique directory below `tmpdir()`, write a minimal `package.json` and
`pnpm-lock.yaml`, run the existing assertions, and remove the directory during
cleanup.

This is the selected option. It supplies real inputs to the production parser,
does not mutate the repository, and is independent of the host path.

### 2. Committed fixture directory

A fixture is inspectable and reusable, but it adds permanent repository files
for one test and can drift from the assertions that consume it.

### 3. Repository root as the fixture

This is the smallest edit, but it couples the test to the root manifest,
lockfile, package-manager version, and future workspace changes. It also makes
the unit test less isolated.

## Detailed Design

The test will import `mkdtempSync`, `rmSync`, and `writeFileSync` from
`node:fs`, `tmpdir` from `node:os`, and `join` from `node:path` if those imports
are not already present.

At test setup, it will create a directory using a descriptive prefix such as
`risk-agent-package-manager-write-`. Inside that directory it will write:

- `package.json` with a private package name and
  `"packageManager": "pnpm@9.0.0"`.
- `pnpm-lock.yaml` with a valid lockfile version marker.

The existing `package_manager_write` input and sandbox context will use the
temporary directory as `cwd`. The current assertions remain responsible for
verifying the requested command, arguments, access tier, and result envelope.

Cleanup will run in a `finally` block so a failed assertion cannot leave the
fixture on disk. Recursive forced removal is acceptable because the target is
the unique directory returned by `mkdtempSync`.

## Error Handling

Fixture creation failures should fail the test immediately with the underlying
filesystem error. Cleanup uses forced removal so partial fixture creation does
not mask the original assertion failure.

## Verification

1. Demonstrate the current focused test fails because the hard-coded manifest
   path does not exist.
2. Apply the test-only change.
3. Run the focused `DeveloperProbeTools.spec.ts` suite from the isolated
   worktree and confirm all tests pass.
4. Run typecheck and lint directly through the installed tool binaries if the
   host pnpm wrapper blocks scripts before command execution.
5. Run the broad test suite and distinguish repository failures from local
   native-addon installation failures.

## Acceptance Criteria

- No workstation-specific absolute path remains in the test.
- The test creates a real, minimal package-manager workspace.
- The fixture is removed after success or failure.
- Focused tests, typecheck, and lint pass.
- The implementation PR closes issue #1.
