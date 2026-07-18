# Node.js 24 Runtime Baseline Design

**Issue:** https://github.com/aiis2/risk-agent/issues/4

## Context

Risk Agent currently declares Node.js `>=20`, documents Node.js 20 as the
minimum, builds releases with Node.js 20, and uses Node.js 20 Alpine images.
Node.js 20 reached end-of-life on 2026-03-24 and no longer receives upstream
security fixes. Node.js 24 is an active LTS release.

The mismatch is already observable in a clean checkout. The lockfile resolves
`better-sqlite3@11.10.0`, which has no Node.js 24 Windows prebuild. Installation
on Node.js 24 falls back to `node-gyp` and fails on ordinary developer machines
without the Visual Studio C++ workload. SQLite is Risk Agent's default
structured store, so the failed native install prevents most core and server
tests from reaching application code.

## Goals

- Use one supported Node.js LTS major across metadata, documentation, Docker,
  and release automation.
- Restore clean native dependency installation without requiring a compiler on
  supported prebuilt platforms.
- Keep SQLiteStore behavior, schemas, and public interfaces unchanged.
- Update compile-time Node.js types with the runtime baseline.
- Avoid unrelated dependency or package-manager churn.

## Non-Goals

- Migrating from pnpm 9.
- Adding a new continuous-integration workflow.
- Changing SQLite schemas or storage APIs.
- Supporting Node.js Current or end-of-life majors.
- Refactoring Docker image structure beyond the runtime version.

## Options Considered

### 1. Node.js 24 LTS and current better-sqlite3

Set the supported runtime to Node.js 24, update every runtime surface, upgrade
`better-sqlite3` to `12.11.1`, and align `@types/node` with major 24.

This is the selected option. It removes the EOL baseline, uses published Node
24 native prebuilds, and gives local, container, and release workflows the same
runtime contract.

### 2. Node.js 22 LTS and better-sqlite3 11

This avoids a native dependency major upgrade, but selects the older supported
LTS and postpones the same migration. It also does not match the environment
where the failure was reproduced.

### 3. Keep Node.js 20+ and require native build tools

Documenting Visual Studio, Python, `make`, and `g++` would explain the fallback
but would retain an EOL security baseline and an unnecessarily fragile default
installation.

## Detailed Design

### Runtime contract

The root `package.json` engine becomes `>=24 <25`. This intentionally supports
the active Node.js 24 LTS major rather than making an unverified promise for
future majors. README setup text, both Docker stages, and the desktop release
workflow will use Node.js 24.

The pnpm version remains `9.0.0`. This keeps package-manager behavior outside
the migration and lets the implementation diff isolate runtime compatibility.

### Native SQLite dependency

`packages/core/package.json` will require `better-sqlite3@^12.11.1`. The
lockfile will resolve exactly `12.11.1` and use its published integrity value.
The package continues to use `bindings` and `prebuild-install`, so no production
imports or SQLiteStore calls need to change.

The implementation will first verify the current Node.js 24 install failure,
then verify the upgraded package downloads a compatible prebuild and can open
an in-memory database. Existing storage tests provide behavioral regression
coverage for schemas, queries, transactions, and registry initialization.

### Compile-time types

All four manifests that directly declare `@types/node` will move from major 20
to `^24.13.0`. The lockfile will resolve the current compatible 24.x release and
its matching `undici-types` dependency. Typecheck is the acceptance gate for
any Node API declaration changes.

### Lockfile discipline

Only the importer specifiers and snapshots required by `better-sqlite3` and
`@types/node` may change. A frozen install after editing must accept the
lockfile without rewriting it. Unrelated transitive upgrades are out of scope.

## Error Handling And Rollback

If the native smoke test or SQLite storage suite exposes a breaking behavior in
`better-sqlite3` 12, the implementation stops before merge and records the
failure on issue #4. It must not weaken storage assertions or fall back to a
stub database. The branch can be reverted without a data migration because no
schema or persisted data format is intentionally changed.

## Verification

1. Reproduce the Node.js 24 install failure with the current lockfile.
2. Apply manifest, lockfile, documentation, Docker, and workflow edits.
3. Run a clean frozen install on Node.js 24.
4. Load `better-sqlite3` and open/query an in-memory database.
5. Run typecheck and lint.
6. Run the full Vitest workspace, with special attention to SQLite storage
   tests that were previously blocked by the missing binding.
7. Run the full build and build the server Docker image when Docker is
   available.
8. Confirm the diff contains no Node.js 20 runtime references or unrelated
   dependency updates.

## Acceptance Criteria

- Node.js 24 is the consistent supported runtime across all declared surfaces.
- Frozen installation succeeds on Node.js 24 without local C++ compilation for
  `better-sqlite3` on a published prebuild platform.
- The native SQLite smoke test and existing storage tests pass.
- Typecheck, lint, full tests, and package builds pass.
- Lockfile changes are limited to the intended runtime dependencies.
- The implementation PR closes issue #4.
