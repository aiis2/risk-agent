# HTTP Client Dependency Security Design

## Context

Issue #22 records the production dependency audit baseline on
`origin/main@136383ee4278eb6739ad97451ef2bac713750083`. The repository's
normal test baseline passes 100 files and 520 tests, but an official-registry
production audit reports 20 high-severity advisories.

Twelve of those high findings come from two direct dependencies with patched
releases inside their existing major-version lines:

- `packages/web` resolves `axios@1.15.0`. Eleven high advisories affect that
  version, and the newest listed fixes require Axios 1.16.0.
- `packages/core` resolves `undici@6.25.0`. One high WebSocket fragmentation
  denial-of-service advisory and three lower findings are fixed by Undici
  6.27.0.

Both manifests use ranges that predate the fixed versions. A frozen install
therefore reproduces the vulnerable lockfile resolutions. The configured
npmmirror registry does not implement the npm audit endpoint, so security
verification must explicitly query `https://registry.npmjs.org`.

## Goals

- Prevent frozen installs from resolving Axios below 1.16.0.
- Prevent frozen installs from resolving Undici below 6.27.0 or crossing into
  the independent Undici 7 major line.
- Remove the known Axios and Undici advisory families from the official npm
  production audit.
- Add a deterministic, network-free regression test for the declared and
  installed dependency versions.
- Keep the change limited to direct HTTP client manifests, their lockfile
  graph, the regression test, and this cycle's documentation.

## Non-goals

- Migrating Fastify 4 and its plugins to Fastify 5.
- Clearing every current audit finding in one pull request.
- Updating React, Vite, Electron, ESLint, or unrelated dependencies.
- Performing a recursive or major-version dependency refresh.
- Changing the repository registry configuration.
- Changing HTTP client behavior or application source.

## Approaches considered

### 1. Targeted direct dependency floors (selected)

Raise the Axios range to `^1.16.0` and the Undici range to `^6.27.0`, then ask
pnpm to refresh only those direct dependencies and required transitive
resolutions. This makes the security floor visible in manifests and minimizes
lockfile churn. The existing request code remains on compatible major lines.

This approach removes most current high findings while keeping the Fastify
major migration and independent transitive advisory families reviewable in
later cycles.

### 2. Refresh every dependency within its current range

A recursive update would likely clear additional transitive findings, but it
would also move unrelated UI, build, desktop, and server packages. Failures
would be harder to attribute, and the review would no longer have a narrow
security contract.

### 3. Upgrade all vulnerable packages and Fastify together

This could reduce the audit count further in one cycle, but Fastify 5 requires
plugin compatibility work and potentially behavioral migration. Combining it
with HTTP client patches would mix unrelated runtime surfaces and enlarge the
rollback boundary.

## Dependency contract

`packages/web/package.json` declares Axios `^1.16.0`. The lockfile may select a
newer compatible 1.x release, but the installed package must be at least
1.16.0 and remain below 2.0.0.

`packages/core/package.json` declares Undici `^6.27.0`. The installed package
must be at least 6.27.0 and remain below 7.0.0. Undici 7 used transitively by
test tooling is a separate graph and does not satisfy the core runtime
contract.

The implementation uses pnpm's targeted update command rather than editing
lockfile YAML by hand. The frozen lockfile remains the source of truth for
clean installs.

## Regression test

Add a core test because Undici is owned by core and core already contains the
cross-workspace build contract test. The test locates the workspace root from
`import.meta.url`, parses the two package manifests with `JSON.parse`, and
asserts their explicit minimum ranges.

Use `createRequire` anchored at each owning package's `package.json` to resolve
the installed Axios and Undici package metadata through pnpm's real workspace
layout. Parse those package JSON files and compare their numeric stable
versions against the required floors and major-version ceilings.

This test is intentionally offline. It fails on the current frozen install
because Axios resolves to 1.15.0 and Undici resolves to 6.25.0. It does not
duplicate the network audit service or hard-code every advisory identifier.

## Audit verification

Run the production audit with the official registry explicitly:

```powershell
corepack pnpm audit --prod --json --registry=https://registry.npmjs.org
```

The command may remain non-zero because independent Fastify and transitive
advisories are out of scope. Verification parses the JSON and requires:

- no Axios advisory;
- no Undici advisory in the core 6.x runtime graph;
- a high-severity count below the baseline of 20.

The exact remaining count is recorded in the implementation PR rather than
guessed in this specification.

## Failure handling

If the targeted pnpm update changes unrelated direct manifests, restore the
scope before proceeding. If a fixed client version breaks typecheck, tests, or
builds, address only compatibility caused by that version or split the client
into a separate issue; do not hide the failure by weakening tests.

If the official audit introduces new advisories while the PR is open, record
the new baseline and distinguish them from the Axios/Undici acceptance
criteria. Audit endpoint failure is a verification failure, not a clean audit.

## Verification

1. Record RED from the dependency contract test on the current frozen
   resolutions.
2. Apply the two targeted dependency updates and record GREEN.
3. Run clean typecheck, lint, all tests, and the workspace build.
4. Run the official-registry production audit and compare structured advisory
   data with the 20-high baseline.
5. Verify unrelated manifests and production source are unchanged.
6. Clone the pushed implementation head, perform a frozen install, and repeat
   the dependency contract, build, and audit checks.
7. Run Windows, macOS, and Linux native desktop packaging and artifact
   validation at the exact implementation head.

## Acceptance criteria

- Axios has a declared floor of 1.16.0 and installs on the 1.x line at or above
  that floor.
- Undici has a declared floor of 6.27.0 and installs on the 6.x line at or above
  that floor.
- The offline regression test proves both manifest and installed versions.
- Official-registry production audit contains no scoped Axios or Undici
  advisories and reports fewer than 20 high findings.
- Typecheck, lint, 100 test files / 520 existing tests plus the new test, and
  workspace build pass.
- Native desktop packages validate on Windows, macOS, and Linux.
- No application source, unrelated manifest, registry setting, or release
  workflow changes.

## Implementation evidence

The targeted update resolves Axios 1.16.0, its patched FormData 4.0.6 graph,
and core Undici 6.27.0. Unrelated Babel, Undici 7, and workspace-link changes
produced by pnpm's initial re-resolution were excluded from the final
lockfile.

The official-registry production audit changed from 20 high, 27 moderate, and
8 low findings to 7 high, 17 moderate, and 5 low findings. Axios and Undici
have no remaining scoped advisories. Clean typecheck, lint, 101 test files / 522
tests, and the workspace build pass on the implementation worktree.
