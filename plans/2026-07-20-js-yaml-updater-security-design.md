# Desktop Updater js-yaml Security Design

## Context

Issue #34 records the production dependency audit baseline on
`origin/main@ff45364af09bd0ece27942ff8e6bdd7df5d47911`. An offline frozen
install and the complete 104-file / 544-test suite pass. The initial audit
snapshot reported 0 critical, 0 high, 2 moderate, and 1 low findings, but a
fresh official-registry audit on 2026-07-22 reports 0 critical, 2 high, 12
moderate, and 2 low findings across the same 654 dependencies. The live result
contains 16 advisory records because new upstream advisories were published
after Issue #34 was opened.

Two records now belong to the installed desktop production path:

```text
@risk-agent/desktop -> electron-updater@6.8.3 -> js-yaml@4.1.1
```

- GHSA-h67p-54hq-rp68 / CVE-2026-53550 is moderate, affects 4.1.1 through
  repeated aliases in merge sequences, and is patched in 4.2.0.
- GHSA-52cp-r559-cp3m / CVE-2026-59869 is high, affects every v4 release below
  4.3.0 through chained merge mappings, and is patched in 4.3.0.

A package-anchored local reproduction against the exact installed transitive
package showed one quadratic merge pattern rising from 43.1 ms at 12.9 KB to
952.0 ms at 54.9 KB, while similarly sized controls remained below 3.1 ms.
This demonstrates the affected parser behavior without claiming that current
release artifacts expose remote update metadata or that the local trial
reproduces every upstream advisory variant.

The application enables electron-updater only when Electron reports a
packaged application and `resources/app-update.yml` exists. Both
`packages/desktop/electron-builder.json` and the isolated release builder
set `publish: null`, so normal current artifacts do not create that update
configuration. The risk is therefore latent today. If publishing is enabled,
electron-updater synchronously parses local update configuration and fetched
channel YAML in the Electron main process, making the advisory relevant to
application availability.

electron-updater 6.8.3 declares `js-yaml@^4.1.0`. The current v4 legacy
release is 4.3.0, so the vulnerable child can be replaced without changing
electron-updater, a package manifest, application source, or release
configuration.

The lockfile contains one shared js-yaml 4.1.1 node. It is used by the
production updater path and by build or lint tooling such as electron-builder
and ESLint. The implementation must therefore keep a narrow lock diff while
running the complete lint, build, and native packaging gates.

## Goals

- Resolve `@risk-agent/desktop -> electron-updater -> js-yaml` to a stable
  version at or above the aggregate advisory-patched 4.3.0 floor and below
  5.0.0.
- Target the current `v4-legacy` release, js-yaml 4.3.0, without upgrading
  electron-updater or adding a direct dependency.
- Remove every js-yaml record from the official production audit.
- Add a deterministic, network-free installed-graph contract anchored through
  the desktop package and electron-updater package manifests.
- Preserve updater gating, desktop startup, release configuration, linting,
  workspace builds, and native Windows, macOS, and Linux packaging.
- Limit the lockfile diff to the shared js-yaml package/snapshot replacement
  and parent references that already point to that node.

## Non-goals

- Enabling automatic updates or adding a publish provider.
- Changing `canUseAutoUpdater`, updater event handling, download behavior, or
  release signing.
- Upgrading electron-updater, electron-builder, ESLint, or another parent.
- Adding a direct js-yaml dependency, pnpm override, or application parser
  workaround.
- Migrating to js-yaml 5.
- Adding a timing-sensitive performance test for the upstream advisory.
- Fixing Axios, Hono, body-parser, React Router, esbuild, or another
  independent advisory family in this cycle.
- Refactoring dependency security helpers across packages.

## Approaches considered

### 1. Refresh the shared js-yaml node to 4.3.0 (selected)

Keep every manifest and parent version unchanged, replace the compatible
shared js-yaml 4.1.1 lock node with 4.3.0, and protect the production updater
path with a package-anchored floor contract.

This is the smallest change that removes the scoped audit record. The target
retains the v4 CommonJS interface and argparse dependency, satisfies every
existing `^4.1.0` parent range, and avoids an unrelated updater or packaging
upgrade.

### 2. Upgrade electron-updater

The parent already accepts a patched js-yaml release. Upgrading it would
expand update-provider, download, signature, staging, Electron, and packaging
behavior without being required for the advisory. It is not justified in this
cycle.

### 3. Add a global override or direct dependency

An override would hide the current owner relationship and affect every
js-yaml path by policy. A direct desktop dependency would not describe the
application's real import boundary. Neither is needed while all existing
parents accept 4.3.0.

### 4. Defer because publishing is disabled

Current artifacts do not expose channel metadata, so immediate exploitability
is limited. Deferral would still retain a reproducibly quadratic parser in a
production dependency and leave both the high and moderate records ready to
become reachable when publishing is configured. The compatible lock-only
repair has lower long-term risk.

## Dependency contract

Create
`packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts`. Keep the
resolver local to the desktop test package rather than moving the existing
server or web helpers into a new shared test abstraction.

The desktop manifest is the root of the contract. The test first confirms
that `@risk-agent/desktop` declares electron-updater. It resolves
electron-updater from a `createRequire` anchored at
`packages/desktop/package.json`, then reads the actual resolved package
manifest.

The test confirms electron-updater declares js-yaml, re-anchors
`createRequire` at the resolved electron-updater manifest, resolves
js-yaml, and walks upward until it finds a package manifest whose `name` is
`js-yaml`. This follows the installed pnpm graph rather than relying on a
root-hoisted package or parsing `pnpm-lock.yaml` as text.

The resulting version must be a stable `major.minor.patch` value satisfying:

```text
4.3.0 <= electron-updater -> js-yaml < 5.0.0
```

The floor encodes the aggregate patched v4 line for both current advisories.
The implementation installs 4.3.0 because it is the first v4 release that
clears both records and the current v4 legacy release. A later compatible v4
refresh remains valid, while a return below 4.3.0 or an unreviewed major
upgrade fails offline.

## TDD strategy

Add the dependency contract before changing the lockfile. On the
specification-merged base, the resolver must successfully reach:

```text
@risk-agent/desktop -> electron-updater@6.8.3 -> js-yaml@4.1.1
```

The test must fail only because 4.1.1 is below 4.3.0. A package resolution,
manifest ownership, or version parsing error is not the required RED result.
Commit and push that failing contract as an intermediate implementation
commit.

After the targeted lock refresh, the unchanged test must resolve js-yaml
4.3.0 and pass the floor and major ceiling. Run it with the two existing
desktop boundaries most relevant to the change:

```text
packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts
packages/desktop/src/__tests__/main.spec.ts
packages/desktop/src/__tests__/releaseWorkflow.spec.ts
```

The current two files contain 11 tests. Adding the dependency case makes the
focused result 3 files / 12 tests and the complete repository result 105 files
/ 545 tests, assuming no concurrent test additions.

Do not commit the timing reproduction as an automated test. Wall-clock
thresholds are environment-sensitive and the official affected range plus
the deterministic installed-version contract provides a stable regression
gate.

## Lockfile update

Do not change a package manifest. Replace the one shared js-yaml package and
snapshot node from 4.1.1 to 4.3.0, use the verified 4.3.0 integrity, and
replace every existing parent reference to that shared node. The seven parent
snapshots are `@eslint/eslintrc`, `app-builder-lib`, `builder-util`,
`dmg-builder`, `electron-updater`, `eslint`, and `read-config-file`; all
declare `js-yaml@^4.1.0`.

The expected integrity is:

```text
sha512-1td788aAnnZ5qs7V2QIRl1owjtYpbKt749Y3xauqQgwIIGF/xXWz1wMTEBx5O3LK3lXLVuqXPdPxj2BoFHaW9Q==
```

js-yaml 4.3.0 retains `argparse@^2.0.1`, which resolves to the existing
argparse 2.0.1 node. No new package should enter the graph. The expected lock
diff is 9 hunks and 10 additions / 10 deletions: one package/integrity hunk,
seven parent-reference hunks, and one snapshot-key hunk.

Inspect the complete lock diff after the editor update. Reject unrelated
package movement, workspace link normalization, deprecation metadata,
injected dependency changes, parent upgrades, or a second js-yaml version.
A frozen install must accept the edited graph without rewriting the lockfile.

## Updater and packaging boundary

No application source or release configuration change is planned. Existing
coverage remains responsible for desktop startup and the release graph:

- `main.spec.ts` covers desktop main-process lifecycle behavior.
- `releaseWorkflow.spec.ts` covers frozen dependency installation, all
  workspace builds, isolated platform packaging, artifact validation, and
  unsigned/signed release separation.
- `release-desktop.yml` packages the same frozen graph on Windows, macOS, and
  Linux.

The specification records current updater reachability from source and
configuration rather than adding a permanent test that prevents a future
intentional publishing feature. If a supported updater or packaging behavior
fails after the refresh, first reproduce the smallest compatibility change.
Do not weaken the security floor or enable/disable publishing to make the
graph pass.

## Audit verification

Run the network security gate explicitly against the official registry:

```powershell
corepack pnpm audit --prod --json --registry=https://registry.npmjs.org
```

Parse the JSON even though the command exits non-zero for independent
findings. The 2026-07-22 live baseline is 0 critical, 2 high, 12 moderate, and
2 low findings with 16 advisory records across 654 dependencies. js-yaml
contributes one high and one moderate record. With no further registry change,
the refresh is expected to leave at most 1 high, 11 moderate, and 2 low
findings with zero js-yaml records. The residual modules are Axios, Hono,
body-parser, React Router, and esbuild.

Require zero critical and zero js-yaml records. A stricter live result is
acceptable with an explanation. A worse result or a new unrelated advisory
must be recorded against a fresh baseline rather than silently treated as a
failure of this scoped lock refresh.

A worse live result blocks completion until Issue #34 and both plans are
updated and independently re-reviewed. A registry endpoint failure is not a
clean audit.

## Failure handling

If package-anchored resolution cannot reach js-yaml through electron-updater,
inspect the actual installed manifests and entry points. Do not fall back to
root resolution or lockfile text parsing.

If a frozen install rewrites the lockfile, compare the graph with the verified
4.3.0 metadata and retain only movement required for the shared js-yaml node.
Do not hide unexpected changes behind an override.

If lint, electron-builder, updater, or packaging behavior changes, reproduce
the smallest failing boundary under TDD before modifying source or
configuration. Stop and split the work if the correction expands beyond the
bounded dependency refresh.

## Verification

1. Confirm the implementation branch starts from the specification-merged
   `origin/main`.
2. Add the desktop-owned dependency contract and record the required RED on
   js-yaml 4.1.1.
3. Apply only the verified js-yaml 4.3.0 shared-node replacement and run a
   frozen install without lockfile rewrite.
4. Record dependency GREEN and run the focused 3-file / 12-test desktop set.
5. Run clean typecheck, typecheck, lint, all tests, workspace build, and diff
   checks sequentially.
6. Remove only the five generated install paths after exact worktree
   validation, then prove an offline frozen reconstruction and rerun the
   focused and full gates.
7. Parse the official audit and require zero js-yaml records.
8. Verify no manifest, application source, release configuration, workflow,
   parent version, or unrelated lock movement entered the implementation.
9. Complete independent specification-compliance and code-quality review,
   resolve every valid finding, and freeze the expected remote SHA.
10. Clone that exact pushed head and repeat frozen install, focused/full
    tests, typecheck, lint, build, structured audit, diff, and clean-status
    checks.
11. Run Windows, macOS, and Linux native packaging at the same SHA; require
    three non-empty artifacts and zero annotations.

## Acceptance criteria

- The production updater path resolves a stable js-yaml version satisfying
  `>=4.3.0 <5`, with 4.3.0 as the intended lock target.
- The package-anchored contract fails on 4.1.1 for the expected floor
  assertion and passes unchanged after the targeted refresh.
- electron-updater remains on 6.8.3 and every package manifest, application
  source file, release configuration, and workflow remains unchanged.
- The lockfile contains one js-yaml 4.3.0 node, no js-yaml 4.1.1 node, and no
  unrelated package movement.
- Existing desktop lifecycle and release coverage passes.
- With no newer registry advisory, the official production audit reports 0
  critical, at most 1 high, at most 11 moderate, and at most 2 low findings,
  with zero js-yaml records. Any live change is documented and re-reviewed.
- Frozen install, offline reconstruction, clean typecheck, typecheck, lint,
  all 105 files / 545 tests, and the workspace build pass.
- Exact remote-head verification is clean and reproducible.
- Native desktop packages validate on Windows, macOS, and Linux with three
  non-empty artifacts and zero annotations.
- Specification and implementation are delivered through separate reviewed
  PRs, each branched from the appropriate current `origin/main`; the
  specification PR is documentation-only and squash-merged before
  implementation starts.

## Implementation evidence (2026-07-22)

- The implementation branch started from the specification merge at
  `origin/main@e69d50bd105b71bac6b727be61223526f7790ad9`. Before these
  evidence updates, the branch changed only the desktop dependency contract
  and `pnpm-lock.yaml`.
- RED commit `114c62a` resolved
  `electron-updater@6.8.3 -> js-yaml@4.1.1` and failed only on the intended
  `4.3.0` floor assertion. GREEN commit `2c3525b` left the test unchanged and
  resolved the same installed path to js-yaml 4.3.0.
- The lock refresh contained nine hunks and exactly 10 additions / 10
  deletions: one package and integrity replacement, seven existing parent
  references, and one snapshot key. The existing `argparse@2.0.1` node,
  parent versions, package manifests, application source, release
  configuration, and workflows were unchanged.
- A frozen install accepted the graph without rewriting the lockfile, and
  `pnpm why` reported
  `@risk-agent/desktop -> electron-updater@6.8.3 -> js-yaml@4.3.0`. The
  focused desktop gate passed 3 files / 12 tests.
- Serial clean typecheck, typecheck, lint, the complete 105-file / 545-test
  suite, the workspace build, and diff checks passed. Vite transformed 8,777
  modules during the successful build.
- After exact worktree validation, only the five planned `node_modules`
  paths were removed. The offline frozen reconstruction restored 1,071
  packages with zero downloads, after which clean typecheck, typecheck, the
  focused 3-file / 12-test gate, and the complete 105-file / 545-test suite
  passed again.
- The official production audit reported 0 critical, 1 high, 11 moderate,
  and 2 low findings across 654 dependencies and 14 advisory records. It
  contained zero js-yaml records. The residual records belong to Axios (10),
  React Router (1), Hono (1), body-parser (1), and esbuild (1).
- Independent review, immutable remote-head verification, and native
  Windows, macOS, and Linux release validation remain integration gates and
  will be recorded on the implementation PR without another repository
  commit.
