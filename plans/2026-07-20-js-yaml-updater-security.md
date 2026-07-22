# Desktop Updater js-yaml Security Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Patch electron-updater's installed js-yaml parser and prevent frozen installs from returning to an affected v4 release.

**Architecture:** Add a desktop-owned package metadata contract that resolves js-yaml through the installed electron-updater package, then replace only the compatible shared js-yaml lock node. Preserve every manifest, updater source file, and release configuration while proving desktop behavior, repository gates, official audit results, exact remote head, and native release artifacts.

**Tech Stack:** pnpm 9 frozen lockfile, Node.js 24, TypeScript, Vitest, Electron 42, electron-updater 6, js-yaml 4, npm advisory API

---

## Implementation branch prerequisite

Merge this cycle's specification PR before starting implementation. Fetch the
resulting `origin/main`, verify it contains both desktop updater js-yaml
security plans, and create `codex/impl-34-js-yaml-parser-security` directly
from that updated remote head.

Do not branch from the specification branch, the dirty root `main`, or a
trial worktree. Record the specification merge commit as the implementation
base.

The specification PR must contain only these two `plans/` documents, pass
Prettier and diff checks, receive independent compliance and quality review,
be marked ready, and be squash-merged before this prerequisite is satisfied.

## Task 1: Add the installed updater parser dependency contract

**Files:**

- Create:
  `packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts`
- Inspect: `packages/desktop/package.json`
- Inspect:
  `packages/server/src/__tests__/runtimeDependencySecurity.spec.ts`
- Inspect:
  `packages/web/src/__tests__/runtimeDependencySecurity.spec.ts`

### Step 1: Create the desktop-local package resolver

Use `apply_patch` to create the test with this complete structure:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  dependencies?: Record<string, string>;
  name?: string;
  version?: string;
}

interface ResolvedPackage {
  manifest: PackageJson;
  manifestPath: string;
}

type StableVersion = [number, number, number];

const desktopManifestPath = fileURLToPath(new URL('../../package.json', import.meta.url));

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
}

function findPackageManifest(resolvedPath: string, packageName: string): ResolvedPackage {
  let directory = dirname(resolvedPath);

  while (true) {
    const manifestPath = join(directory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = readPackageJson(manifestPath);
      if (manifest.name === packageName) return { manifest, manifestPath };
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Unable to locate package metadata for ${packageName}`);
    }
    directory = parent;
  }
}

function resolvePackage(anchorPath: string, packageName: string): ResolvedPackage {
  const anchorRequire = createRequire(anchorPath);
  let resolvedPath: string;

  try {
    resolvedPath = anchorRequire.resolve(`${packageName}/package.json`);
  } catch {
    resolvedPath = anchorRequire.resolve(packageName);
  }

  return findPackageManifest(resolvedPath, packageName);
}

function parseStableVersion(version: string): StableVersion {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) {
    throw new Error(`Expected a stable semantic version, received ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(left: StableVersion, right: StableVersion): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

describe('desktop updater dependency security floor', () => {
  it('resolves a patched js-yaml release through electron-updater', () => {
    const desktopManifest = readPackageJson(desktopManifestPath);
    expect(desktopManifest.dependencies?.['electron-updater']).toBeDefined();

    const updaterPackage = resolvePackage(desktopManifestPath, 'electron-updater');
    expect(updaterPackage.manifest.dependencies?.['js-yaml']).toBeDefined();

    const jsYamlManifest = resolvePackage(updaterPackage.manifestPath, 'js-yaml').manifest;
    if (!jsYamlManifest.version) {
      throw new Error('js-yaml package metadata does not declare a version');
    }

    const installedVersion = parseStableVersion(jsYamlManifest.version);
    const floor: StableVersion = [4, 3, 0];
    const ceiling: StableVersion = [5, 0, 0];

    expect(
      compareVersion(installedVersion, floor),
      `electron-updater -> js-yaml resolves js-yaml@${jsYamlManifest.version}, below ${floor.join('.')}`
    ).toBeGreaterThanOrEqual(0);
    expect(
      compareVersion(installedVersion, ceiling),
      `electron-updater -> js-yaml crossed into ${ceiling[0]}.x at ${jsYamlManifest.version}`
    ).toBeLessThan(0);
  });
});
```

Keep the helper local. Do not add `semver`, parse the lockfile, or resolve a
root-hoisted js-yaml package.

### Step 2: Verify formatting and static correctness

Run:

```powershell
corepack pnpm exec prettier --check packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts
corepack pnpm exec eslint packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts
corepack pnpm typecheck
```

Expected: all commands exit zero. These checks validate the new test source
without changing the intentionally vulnerable installed graph.

### Step 3: Run the dependency test to verify RED

Run:

```powershell
corepack pnpm exec vitest run packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts
```

Expected: the resolver reaches
`electron-updater@6.8.3 -> js-yaml@4.1.1`, then the test fails only because
4.1.1 is below 4.3.0. A resolver, declaration, version syntax, or setup error
is not the required RED result.

### Step 4: Commit and push the RED contract

Inspect and stage only the new test:

```powershell
git diff -- packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts
git add packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts
git diff --cached --check
git commit -m "test: enforce updater YAML parser security floor"
git push -u origin codex/impl-34-js-yaml-parser-security
```

The intentionally failing commit is allowed only as an intermediate
implementation PR branch state. It must be followed by the GREEN lock commit
before the branch is marked ready.

## Task 2: Apply the minimal compatible shared lock refresh

**Files:**

- Modify: `pnpm-lock.yaml`
- Test:
  `packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts`

### Step 1: Replace only the verified js-yaml nodes and references

Use `apply_patch` to make these exact logical replacements:

```text
js-yaml@4.1.1 package key/integrity -> js-yaml@4.3.0
seven existing parent references     -> js-yaml: 4.3.0
js-yaml@4.1.1 snapshot key           -> js-yaml@4.3.0
```

The seven parent snapshots are:

```text
@eslint/eslintrc@2.1.4
app-builder-lib@24.13.3(...)
builder-util@24.13.1
dmg-builder@24.13.3(...)
electron-updater@6.8.3
eslint@8.57.1
read-config-file@6.3.2
```

Use this verified 4.3.0 integrity:

```text
sha512-1td788aAnnZ5qs7V2QIRl1owjtYpbKt749Y3xauqQgwIIGF/xXWz1wMTEBx5O3LK3lXLVuqXPdPxj2BoFHaW9Q==
```

Keep the existing `argparse: 2.0.1` snapshot dependency. Do not add or
remove a package, change an importer, or modify a manifest.

### Step 2: Inspect the lockfile boundary

Run:

```powershell
git diff -- pnpm-lock.yaml
git diff --numstat -- pnpm-lock.yaml
git diff --check
```

Expected: 9 hunks and 10 additions / 10 deletions. The only logical movement
is the shared js-yaml version, integrity, snapshot key, and seven existing
parent references. There must be no parent upgrade, argparse movement,
workspace link normalization, deprecation metadata, or unrelated package
refresh.

### Step 3: Recreate the frozen graph

Run:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @risk-agent/desktop why js-yaml --prod
```

Expected: repository-pinned pnpm 9.0.0 accepts the edited lockfile without
rewriting it, and the production path is:

```text
@risk-agent/desktop
└─ electron-updater 6.8.3
   └─ js-yaml 4.3.0
```

The first online frozen install must populate the local pnpm store with
js-yaml 4.3.0 before the later offline reconstruction.

### Step 4: Run the dependency test to verify GREEN

Run:

```powershell
corepack pnpm exec vitest run packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts
```

Expected: 1 passing test resolving a stable js-yaml 4.3.0 within
`>=4.3.0 <5`.

### Step 5: Run the focused desktop behavior set

Run:

```powershell
corepack pnpm exec vitest run packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts packages/desktop/src/__tests__/main.spec.ts packages/desktop/src/__tests__/releaseWorkflow.spec.ts
```

Expected: 3 files / 12 tests pass. This proves the installed updater path,
desktop main lifecycle, frozen release graph, platform packaging commands,
and artifact validation remain compatible.

### Step 6: Commit and push the patched graph

Stage only `pnpm-lock.yaml`, then commit and push:

```powershell
git add pnpm-lock.yaml
git diff --cached --check
git commit -m "security: patch the desktop updater YAML parser"
git push
```

The implementation branch now contains the RED contract commit followed by
the minimal GREEN graph commit.

## Task 3: Verify security and repository behavior

**Files:**

- Verify: `packages/desktop/package.json`
- Verify:
  `packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts`
- Verify: `packages/desktop/src/__tests__/main.spec.ts`
- Verify: `packages/desktop/src/__tests__/releaseWorkflow.spec.ts`
- Verify: `packages/desktop/electron-builder.json`
- Verify: `scripts/build-desktop-release.mjs`
- Verify: `pnpm-lock.yaml`
- Update with evidence:
  `plans/2026-07-20-js-yaml-updater-security-design.md`
- Update with evidence:
  `plans/2026-07-20-js-yaml-updater-security.md`

### Step 1: Run repository quality gates sequentially

Run:

```powershell
corepack pnpm typecheck:clean
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
git diff --check
```

Expected: every command exits zero. With no concurrent additions, the suite
reports 105 files / 545 tests and the Vite module count remains explainable
against the specification base.

Run these commands serially. Do not overlap the Mermaid-heavy full suite with
an independent reviewer or another full test process.

### Step 2: Prove an offline frozen reconstruction

Validate the implementation worktree before any generated-path cleanup:

```powershell
$worktree = [IO.Path]::GetFullPath((git rev-parse --show-toplevel).Trim())
$workspaceRoot = Split-Path (Split-Path $worktree -Parent) -Parent
$expected = [IO.Path]::GetFullPath(
  (Join-Path $workspaceRoot '.worktrees\impl-34-js-yaml-parser-security')
)
if (-not $worktree.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing cleanup outside $expected"
}
git status --short
```

Require clean tracked status, then remove only these generated install paths:

```powershell
$installPaths = @(
  'node_modules',
  'packages/core/node_modules',
  'packages/server/node_modules',
  'packages/web/node_modules',
  'packages/desktop/node_modules'
)
git -c core.longPaths=true clean -ffdx -- $installPaths
foreach ($path in $installPaths) {
  if (Test-Path -LiteralPath $path) {
    throw "Install cleanup failed for $path"
  }
}
git status --short
```

Do not run unscoped `git clean` and do not clean from the dirty root
worktree.

Reconstruct and rerun:

```powershell
corepack pnpm install --offline --frozen-lockfile
corepack pnpm typecheck:clean
corepack pnpm typecheck
corepack pnpm exec vitest run packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts packages/desktop/src/__tests__/main.spec.ts packages/desktop/src/__tests__/releaseWorkflow.spec.ts
corepack pnpm test
```

Expected: the checked-in graph is recreated from the pnpm store and both the
focused and complete compiler/test gates remain green.

### Step 3: Run the structured official-registry audit

Run:

```powershell
corepack pnpm audit --prod --json --registry=https://registry.npmjs.org
```

Parse the JSON despite the expected non-zero exit for independent findings.
The 2026-07-22 live baseline is 0 critical, 2 high, 12 moderate, and 2 low
findings with 16 advisory records across 654 dependencies. js-yaml contributes
one high and one moderate record. With no further registry change, require:

```text
critical: 0
high: <= 1
moderate: <= 11
low: <= 2
js-yaml advisory records: 0
production dependencies: explain any change from 654
```

The expected residual modules are Axios, Hono, body-parser, React Router, and
esbuild. A stricter result may pass with an explanation. A worse result or new
advisory requires a fresh documented baseline and re-review before completion.

### Step 4: Verify implementation boundaries

Compare the complete branch against the recorded implementation base. Require
only:

```text
packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts
pnpm-lock.yaml
plans/2026-07-20-js-yaml-updater-security-design.md
plans/2026-07-20-js-yaml-updater-security.md
```

The two plan files already exist on the base and may only gain execution
evidence. Confirm every package manifest, production source file, release
configuration, workflow, parent package version, and unrelated lock node is
byte-identical to the implementation base.

Require exactly one js-yaml 4.3.0 package/snapshot node, no js-yaml 4.1.1
node, and no package-count increase.

### Step 5: Record evidence, commit, push, and open the implementation PR

Use `apply_patch` to append concise RED, GREEN, lock-scope, focused/full
gate, offline reconstruction, and audit evidence to both plans.

Run Prettier and diff checks, then commit only the evidence updates:

```powershell
corepack pnpm exec prettier --check plans/2026-07-20-js-yaml-updater-security-design.md plans/2026-07-20-js-yaml-updater-security.md
git add plans/2026-07-20-js-yaml-updater-security-design.md plans/2026-07-20-js-yaml-updater-security.md
git diff --cached --check
git commit -m "docs: record updater YAML parser security verification"
git push
```

Open a draft implementation PR targeting `main`. The body must:

- link Issue #34 and the merged specification PR;
- explain the real updater path and current latent reachability;
- state why the lock-only approach is narrower than an updater upgrade or
  override;
- list RED/GREEN, lock scope, repository gates, offline reconstruction, and
  official audit evidence;
- include `Closes #34`;
- identify exact-head and native release validation as pending integration
  gates.

## Task 4: Review, prove the exact remote head, and integrate

**Files:**

- Verify only: the exact pushed implementation head

### Step 1: Complete independent review before freezing

Request independent specification-compliance and code-quality reviews of the
complete branch diff. Resolve every valid correctness, ownership, test,
lockfile, audit, scope, and packaging finding. Rerun affected gates, commit
each correction in English, and push immediately.

Do not begin exact-head or release validation while another commit may still
be required.

### Step 2: Freeze and assert the immutable remote SHA

Fetch the implementation branch and compare the remote branch with the PR:

```powershell
$expectedSha = (
  git rev-parse origin/codex/impl-34-js-yaml-parser-security
).Trim()
$prSha = (
  gh pr view <implementation-pr> --repo aiis2/risk-agent --json headRefOid --jq .headRefOid
).Trim()
if ($expectedSha -ne $prSha) {
  throw 'PR head does not match the fetched remote branch'
}
```

Any later commit invalidates every following gate and requires repeating
Steps 2 through 4.

### Step 3: Verify an isolated frozen checkout at that SHA

Clone the remote implementation branch into:

```text
.worktrees/verify-34-js-yaml-parser-security
```

Validate the exact resolved path and assert `git rev-parse HEAD` equals the
frozen SHA before testing. Run sequentially:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm exec vitest run packages/desktop/src/__tests__/runtimeDependencySecurity.spec.ts packages/desktop/src/__tests__/main.spec.ts packages/desktop/src/__tests__/releaseWorkflow.spec.ts
corepack pnpm typecheck:clean
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm audit --prod --json --registry=https://registry.npmjs.org
git diff --check
git status --short
```

Require the same focused/full counts, audit bounds, and a clean checkout at
the same SHA after every command.

Remove the clone only after validating its exact parent and name. Use only
this target-scoped fallback from the root if normal cleanup leaves files:

```powershell
git -c core.longPaths=true clean -ffdx -- '.worktrees/verify-34-js-yaml-parser-security'
```

### Step 4: Verify native release behavior at the same SHA

Dispatch `.github/workflows/release-desktop.yml` with the implementation
branch ref and capture the returned run ID. Verify the run's `headSha` equals
the frozen SHA before waiting for completion.

Require:

- successful `windows-latest`, `macos-latest`, and `ubuntu-latest` jobs;
- exactly three expected, non-empty, unexpired artifacts;
- every artifact tied to the frozen SHA;
- zero annotations across all three job check runs.

Record the immutable SHA, run ID, artifact names, byte sizes, and annotation
total on the PR through PR metadata only. Do not add another repository
commit.

### Step 5: Mark ready and squash-merge

Re-fetch and confirm:

- remote branch and PR head still equal the frozen SHA;
- the PR is open, non-draft, `CLEAN`, and `MERGEABLE`;
- no review finding remains;
- the exact-head and release gates are still valid.

Mark the PR ready, squash-merge with an English message, and delete the remote
implementation branch. If any repository commit is required, return to Step
2 instead.

Verify Issue #34 closes, the PR is merged, the merge commit is on the new
`origin/main`, and the remote branch is absent.

### Step 6: Clean exact cycle paths and continue

From the root, validate each exact child under `.worktrees`, run
`git worktree remove --force <exact-path>`, then use only the matching
target-scoped long-path fallback if Windows leaves generated files. Run
`git worktree prune`, delete merged local cycle branches, and confirm the
root still contains only its pre-existing `pnpm-workspace.yaml` change.

Audit the resulting `origin/main`. Continue with React Router and then
esbuild as separate Issue -> specification PR -> implementation PR cycles,
subject to the fresh audit ranking.
