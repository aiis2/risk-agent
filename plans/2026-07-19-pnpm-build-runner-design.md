# Active pnpm Build Runner Design

## Context

Issue #19 records a clean-checkout failure on `origin/main@3513852`. The
repository declares pnpm 9.0.0 and the outer `corepack pnpm build` lifecycle
uses that version, but `scripts/build.mjs` starts each nested build with a new
`pnpm` PATH lookup and `shell: true`.

On the observed Windows environment, PATH resolves the nested command to pnpm
11.9.0. That version sees modules installed by pnpm 9 and attempts a modules
purge, then aborts because the non-interactive process has no TTY. Manually
putting the Corepack shim first in PATH makes the build pass, but Node 24 emits
`DEP0190` because the orchestrator passes an argument array through a shell.

## Goals

- Keep the documented `corepack pnpm build` command on the exact package
  manager CLI selected by the outer lifecycle.
- Preserve the current core, server, and web build order and arguments.
- Remove shell mediation from the build orchestrator.
- Handle Windows, macOS, Linux, spaces, and non-ASCII checkout paths with
  structured child-process arguments.
- Fail clearly when the script is run without a package-manager lifecycle.

## Non-goals

- Changing the pnpm version declared by the repository.
- Changing package build commands or adding desktop packaging to the unified
  build.
- Refactoring the separate desktop release runner.
- Adding a general child-process framework for one small orchestrator.
- Changing package manifests, the lockfile, or production application code.

## Approaches considered

### 1. Reuse the active lifecycle CLI (selected)

Package-manager lifecycles expose the active CLI through `npm_execpath`. Run
that JavaScript entry with the already-running `process.execPath`, followed by
the existing pnpm arguments. `spawnSync` receives a command and argument array
without `shell`, so paths and filters do not require platform-specific quoting.

This approach follows the manager/version selected by Corepack rather than
performing a second resolution. It also works with a pnpm installation whose
entry path contains spaces or non-ASCII characters.

### 2. Spawn `corepack pnpm` explicitly

Corepack would honor `packageManager`, but Windows exposes it as a `.cmd` shim.
Starting that shim reintroduces shell handling or requires platform-specific
Corepack installation discovery. It also ignores the more direct lifecycle
contract already available to the script.

### 3. Keep PATH lookup and require a global pnpm

Documenting a global version would duplicate `packageManager`, remain fragile
under version managers and IDE terminals, and retain the Node 24 shell warning.

## Architecture

At startup, `scripts/build.mjs` reads `process.env.npm_execpath`. If the value
is absent, the script prints a clear instruction to run `pnpm build` and exits
non-zero. It never falls back to PATH because that is the behavior causing the
version split.

For each existing argument list, the orchestrator runs:

```js
spawnSync(process.execPath, [packageManagerCli, ...args], {
  stdio: 'inherit',
});
```

The labels printed to users remain `pnpm ...`, and non-zero child status still
terminates the sequence immediately. No new abstraction is needed.

## Behavioral regression test

Add a core test because core is the first package owned by the root build
orchestrator. The test creates an isolated temporary directory containing a
fake package-manager JavaScript entry. The fake entry appends its received
arguments to a log and exits successfully.

The test starts the real `scripts/build.mjs` with:

- `npm_execpath` pointing to the fake entry;
- PATH reduced to the temporary directory, where no `pnpm` executable exists;
- an environment variable pointing to the invocation log.

The current implementation fails because its independent PATH lookup cannot
find pnpm. The corrected implementation succeeds and records exactly three
calls in order:

1. `--filter @risk-agent/core build`
2. `--filter @risk-agent/server build`
3. `--filter @risk-agent/web build`

The test also rejects `DEP0190` in captured stderr. Guaranteed cleanup removes
the fake CLI and log even when an assertion fails.

## Error handling

Missing `npm_execpath` is an actionable invocation error, not a condition for
guessing. Child launch errors and non-zero statuses continue to stop the build
at the failing package. Signals or unknown statuses remain failures.

## Verification

1. Add the behavioral test and record RED against the PATH-based runner.
2. Make the smallest orchestrator change and record GREEN.
3. Run direct `node scripts/build.mjs` and verify the clear lifecycle error.
4. In a clean checkout, show outer Corepack pnpm is 9.0.0 and PATH pnpm is a
   conflicting 11.x version, then run `corepack pnpm build` successfully.
5. Confirm the build output contains no orchestrator `DEP0190` warning.
6. Run typecheck, lint, all tests, diff checks, and exact-head native desktop
   packaging before merge.

## Acceptance criteria

- The nested build uses the same active pnpm CLI as the outer lifecycle.
- A conflicting PATH pnpm cannot affect `corepack pnpm build`.
- Core, server, and web retain their order and existing filter arguments.
- The orchestrator does not use a shell and emits no `DEP0190`.
- Direct invocation fails with a clear `pnpm build` instruction.
- Manifests, lockfile, production source, and release workflow are unchanged.
