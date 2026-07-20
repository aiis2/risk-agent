# DOMPurify Sanitizer Security Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Patch Mermaid's installed DOMPurify sanitizer path and prevent frozen installs from returning to an affected release.

**Architecture:** Add a web-owned package metadata contract that resolves DOMPurify through the installed Mermaid package, then replace only the compatible DOMPurify lock node. Preserve every manifest and application source file while proving Mermaid behavior, repository gates, the official audit, exact remote head, and native release artifacts.

**Tech Stack:** pnpm 9 frozen lockfile, Node.js 24, TypeScript, Vitest, Mermaid 11, DOMPurify 3, npm advisory API

---

## Implementation branch prerequisite

Merge this cycle's specification PR before starting implementation. Fetch the
resulting `origin/main`, verify it contains both DOMPurify sanitizer security
plans, and create the implementation branch directly from that updated remote
head. Do not branch from the specification branch, the trial worktree, or
stale local `main`.

The specification PR must contain only these two `plans/` documents, pass
Prettier and diff checks, receive independent compliance and quality review,
be marked ready, and be squash-merged before this prerequisite is satisfied.

## Task 1: Characterize the Mermaid sanitizer boundary

**Files:**

- Modify: `packages/web/src/components/Chat/__tests__/mermaidCleanup.spec.ts`
- Inspect: `packages/web/src/components/Chat/responseContent.tsx`

**Step 1: Add a hoisted Mermaid module double**

Keep the existing jsdom environment and direct cleanup case. Add React's
`createElement`, Testing Library's `cleanup`, `render`, `screen`, and
`waitFor`, plus Vitest's `afterEach` and `vi`.

Create a hoisted module double before importing `ResponseContent`:

```ts
const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn()
}));

vi.mock('mermaid', () => ({
  default: mermaidMocks
}));
```

Import both `ResponseContent` and `cleanupMermaidScratch` after the mock.
After each case, run Testing Library cleanup, clear the mocks, and empty
`document.body` so scratch nodes cannot leak between cases.

**Step 2: Add one application-boundary characterization**

In one test, configure the first `mermaid.render` call to append both
`d<renderId>` and `<renderId>` scratch nodes and resolve:

```ts
return {
  svg: '<svg data-mermaid-output="true"><text>rendered</text></svg>'
};
```

Configure the second call to append the same two scratch-node forms and reject
with `new Error('unsafe diagram rejected')`.

Render `ResponseContent` with a Mermaid fence. Wait for the returned SVG to
appear, then assert:

```text
initialize called once with startOnLoad=false and securityLevel=strict
render called with a risk-agent-mermaid-* ID and the normalized chart
the returned SVG exists inside the response container
both success-path scratch nodes were removed
```

Rerender with a different Mermaid chart. Wait for `Mermaid rendering failed`
in the localized UI, assert that `unsafe diagram rejected` and the fallback
chart are visible, and prove both failure-path scratch nodes were removed.
Use the actual Chinese label from the component in the assertion; the English
text above describes the behavior only.

**Step 3: Run the characterization on the vulnerable baseline**

Run:

```powershell
corepack pnpm exec vitest run packages/web/src/components/Chat/__tests__/mermaidCleanup.spec.ts
```

Expected: two passing cases on Mermaid 11.15.0 / DOMPurify 3.4.5. This is a
GREEN characterization of supported application behavior, not the dependency
security RED.

**Step 4: Commit and push the characterization**

Stage only the modified test, commit with:

```text
test: characterize Mermaid sanitizer boundary
```

Push the implementation branch immediately.

## Task 2: Add the installed sanitizer dependency contract

**Files:**

- Create: `packages/web/src/__tests__/runtimeDependencySecurity.spec.ts`
- Inspect: `packages/web/package.json`
- Inspect: `packages/server/src/__tests__/runtimeDependencySecurity.spec.ts`

**Step 1: Create the package metadata resolver**

Add a web-local test with these imports and structured metadata types:

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

const webManifestPath = fileURLToPath(new URL('../../package.json', import.meta.url));
```

Read JSON with `readFileSync(path, 'utf8')`. Implement
`findPackageManifest(resolvedPath, packageName)` by walking parent directories
from `dirname(resolvedPath)` until a `package.json` with the requested `name`
is found. Throw a specific error at the filesystem root.

Implement `resolvePackage(anchorPath, packageName)` with
`createRequire(anchorPath)`. Try to resolve `<package>/package.json` first and
fall back to the package entry point when the metadata subpath is not
exported. Return both the parsed manifest and its path from the named upward
walk.

**Step 2: Add stable version helpers**

Parse only stable `major.minor.patch` values:

```ts
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
```

Do not add or import `semver`; the workspace does not directly own it for this
test.

**Step 3: Add the Mermaid-owned DOMPurify assertion**

Create one focused case:

```ts
describe('runtime sanitizer dependency security floor', () => {
  it('resolves a patched DOMPurify release through Mermaid', () => {
    const webManifest = readPackageJson(webManifestPath);
    expect(webManifest.dependencies?.mermaid).toBeDefined();

    const mermaidPackage = resolvePackage(webManifestPath, 'mermaid');
    expect(mermaidPackage.manifest.dependencies?.dompurify).toBeDefined();

    const dompurifyManifest = resolvePackage(mermaidPackage.manifestPath, 'dompurify').manifest;
    if (!dompurifyManifest.version) {
      throw new Error('dompurify package metadata does not declare a version');
    }

    const installedVersion = parseStableVersion(dompurifyManifest.version);
    const floor: StableVersion = [3, 4, 11];
    const ceiling: StableVersion = [4, 0, 0];

    expect(
      compareVersion(installedVersion, floor),
      `mermaid -> dompurify resolves dompurify@${dompurifyManifest.version}, below ${floor.join('.')}`
    ).toBeGreaterThanOrEqual(0);
    expect(
      compareVersion(installedVersion, ceiling),
      `mermaid -> dompurify crossed into ${ceiling[0]}.x at ${dompurifyManifest.version}`
    ).toBeLessThan(0);
  });
});
```

**Step 4: Run the focused test to verify RED**

Run:

```powershell
corepack pnpm exec vitest run packages/web/src/__tests__/runtimeDependencySecurity.spec.ts
```

Expected: the resolver reaches `mermaid@11.15.0 -> dompurify@3.4.5`, and the
test fails only because 3.4.5 is below 3.4.11. A resolver error or declaration
failure is not the required RED result.

**Step 5: Commit and push the RED contract**

Stage only the new test, commit with:

```text
test: enforce DOMPurify sanitizer security floor
```

Push the implementation branch immediately. The intentionally failing commit
is allowed only as an intermediate PR branch state and must not be merged.

## Task 3: Apply the minimal compatible lock refresh

**Files:**

- Modify: `pnpm-lock.yaml`
- Test: `packages/web/src/__tests__/runtimeDependencySecurity.spec.ts`

**Step 1: Replace only the verified DOMPurify nodes**

Use `apply_patch` to make the same logical replacement proven in the trial:

```text
dompurify@3.4.5 package key/integrity -> dompurify@3.4.12
dompurify@3.4.5 snapshot key          -> dompurify@3.4.12
mermaid snapshot child reference      -> dompurify: 3.4.12
```

Use this verified 3.4.12 integrity so the plan remains executable after trial
cleanup:

```text
sha512-zQvGet8Z2sWbQhCmfFz/T5QWH2oBmjnqK3qvOjaqaNLrLEF912WamU+ohnTp0TCep/MFVHpdJuCZEdFOdTnEFg==
```

Do not run a broad recursive update and do not change a manifest.

**Step 2: Inspect the lockfile boundary**

Run:

```powershell
git diff -- pnpm-lock.yaml
git diff --check
```

Expected: eight changed diff lines across three hunks. There must be no Babel,
deprecation metadata, Testing Library, workspace-link, injected package, or
other dependency movement.

**Step 3: Recreate the frozen graph**

Run:

```powershell
corepack pnpm install --frozen-lockfile
```

Expected: pnpm accepts the lockfile without changing it. Confirm the runtime
path with:

```powershell
corepack pnpm --filter @risk-agent/web why dompurify --prod
```

Expected: Mermaid 11.15.0 owns DOMPurify 3.4.12.

**Step 4: Run the dependency test to verify GREEN**

Run the focused test from Task 2. Expected: one passing test resolving a
stable DOMPurify 3.4.12 within `>=3.4.11 <4`.

**Step 5: Run the Mermaid behavior set**

Run:

```powershell
corepack pnpm exec vitest run packages/web/src/__tests__/runtimeDependencySecurity.spec.ts packages/web/src/components/Chat/__tests__/mermaidCleanup.spec.ts packages/web/src/components/Chat/__tests__/responseContent.spec.ts packages/web/src/components/Runs/__tests__/ArtifactPanel.spec.tsx packages/web/src/pages/__tests__/Chat.spec.tsx
```

Expected: five files / 45 tests pass. The added boundary characterization
directly proves strict initialization, returned SVG insertion, failure UI, and
scratch cleanup; the existing chat and artifact cases remain green.

**Step 6: Commit and push the patched graph**

Stage only `pnpm-lock.yaml`, commit with:

```text
security: patch Mermaid's DOMPurify sanitizer
```

Push immediately. The implementation branch now contains the RED contract
commit followed by the minimal GREEN graph commit.

## Task 4: Verify security and repository behavior

**Files:**

- Verify: `packages/web/package.json`
- Verify: `packages/web/src/__tests__/runtimeDependencySecurity.spec.ts`
- Verify: `packages/web/src/components/Chat/__tests__/mermaidCleanup.spec.ts`
- Verify: `pnpm-lock.yaml`
- Update with evidence: `plans/2026-07-20-dompurify-sanitizer-security-design.md`
- Update with evidence: `plans/2026-07-20-dompurify-sanitizer-security.md`

**Step 1: Run repository quality gates**

Run sequentially:

```powershell
corepack pnpm typecheck:clean
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
git diff --check
```

Expected: every command exits zero. With no concurrent upstream additions,
the suite reports 104 files / 544 tests after the new dependency case and the
new characterization in an existing file.

**Step 2: Prove a subsequent offline frozen install**

From the implementation worktree, validate the resolved target before any
cleanup:

```powershell
$worktree = [IO.Path]::GetFullPath((git rev-parse --show-toplevel).Trim())
$workspaceRoot = Split-Path (Split-Path $worktree -Parent) -Parent
$expected = [IO.Path]::GetFullPath((Join-Path $workspaceRoot '.worktrees\impl-31-dompurify-sanitizer-security'))
if (-not $worktree.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing cleanup outside $expected"
}
git status --short
```

Require clean tracked status, then remove only the generated install paths:

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
  if (Test-Path -LiteralPath $path) { throw "Install cleanup failed for $path" }
}
git status --short
```

Do not run unscoped `git clean`, do not run cleanup from the dirty root
worktree, and do not remove the registered implementation worktree here. Then
run:

```powershell
corepack pnpm install --offline --frozen-lockfile
corepack pnpm typecheck:clean
corepack pnpm typecheck
corepack pnpm exec vitest run packages/web/src/__tests__/runtimeDependencySecurity.spec.ts packages/web/src/components/Chat/__tests__/mermaidCleanup.spec.ts packages/web/src/components/Chat/__tests__/responseContent.spec.ts packages/web/src/components/Runs/__tests__/ArtifactPanel.spec.tsx packages/web/src/pages/__tests__/Chat.spec.tsx
corepack pnpm test
```

Expected: the checked-in graph is reconstructed from the pnpm store and all
focused/full compiler and test gates remain green.

**Step 3: Run the structured official-registry audit**

Run:

```powershell
corepack pnpm audit --prod --json --registry=https://registry.npmjs.org
```

Parse the JSON despite the expected non-zero exit for independent findings.
Require 0 critical, 0 high, 2 moderate, 1 low, and zero DOMPurify advisory
records across the production graph. A stricter result may pass with an
explanation. A worse result blocks completion until Issue #31 and both plans
are updated and independently re-reviewed.

**Step 4: Verify change boundaries**

Require no implementation diff outside the modified Mermaid boundary test,
the new web dependency security test, the three logical DOMPurify lock
replacements, and evidence appended to the two merged plan documents. Confirm
every package manifest and application source file is byte-identical to the
implementation base.

If supported Mermaid behavior fails, reproduce the failure under TDD and
update Issue #31 and both plans before making the smallest required source
change. Stop and split the work if that correction is not bounded.

**Step 5: Record evidence, commit, push, and open the implementation PR**

Append concise RED, GREEN, lock-scope, frozen reconstruction, full-gate, and
audit evidence to both plan documents. Commit those evidence updates with:

```text
docs: record DOMPurify security verification
```

Push immediately. Open a draft implementation PR targeting `main`, link Issue
#31 and the merged specification PR, explain the reason and plan, and include
`Closes #31`.

## Task 5: Review, prove the exact remote head, and integrate

**Files:**

- Verify only: exact pushed implementation head

**Step 1: Complete independent review before freezing the head**

Request independent specification-compliance and code-quality reviews of the
complete diff. Resolve every valid correctness, test, scope, lockfile, or
packaging finding, rerun the affected local gates, commit, and push. Do not
start exact-head or release validation while review findings can still create
another commit.

**Step 2: Freeze and assert the immutable remote SHA**

Fetch the implementation branch and capture:

```powershell
$expectedSha = (git rev-parse origin/codex/impl-31-dompurify-sanitizer-security).Trim()
$prSha = gh pr view <implementation-pr> --repo aiis2/risk-agent --json headRefOid --jq .headRefOid
if ($expectedSha -ne $prSha) { throw 'PR head does not match the fetched remote branch' }
```

Record `$expectedSha` on the draft PR. Any later commit invalidates every
following gate and requires repeating Steps 2-4.

**Step 3: Verify an isolated frozen checkout at that SHA**

Clone the remote implementation branch into an exact, validated temporary
path and assert `git rev-parse HEAD` equals `$expectedSha` before testing. Run
frozen install, the five focused Mermaid files / 45 tests, clean typecheck,
typecheck, lint, the full 104-file / 544-test suite, workspace build,
structured official audit, `git diff --check`, and `git status --short`.
Require a clean checkout at the same SHA after every command.

Remove the temporary clone only after validating that its resolved path is the
exact named child under `.worktrees`. Use the long-path-safe, target-scoped
fallback from the root only if normal removal leaves files:

```powershell
git -c core.longPaths=true clean -ffdx -- '.worktrees/verify-31-dompurify-sanitizer-security'
```

Never run the fallback without the exact path argument.

**Step 4: Verify native release behavior at the same SHA**

Dispatch `.github/workflows/release-desktop.yml` with the implementation
branch ref and capture the resulting run ID. After completion, query the run
and require its `headSha` to equal `$expectedSha`. Require successful Windows,
macOS, and Linux jobs, three non-empty artifacts, and zero check-run
annotations. Record the immutable SHA, run ID, artifact names, and byte sizes
on the PR.

**Step 5: Mark ready and integrate without another commit**

Confirm the PR head still equals `$expectedSha`, no review finding remains,
and no commit was added after exact-head/release validation. Mark the PR ready,
confirm `CLEAN/MERGEABLE`, squash-merge, and verify Issue #31 closes and
`origin/main` advances. If any commit is required, return to Step 2.

**Step 6: Clean registered worktrees and continue**

From the root worktree, compute each exact cycle path under `.worktrees` and
verify its parent is the repository's `.worktrees` directory. For every
registered spec, implementation, audit, or trial worktree, run
`git worktree remove --force <exact-path>` first. If Windows reparse points or
long paths leave the exact directory behind, run only the corresponding
target-scoped fallback, for example:

```powershell
git -c core.longPaths=true clean -ffdx -- '.worktrees/impl-31-dompurify-sanitizer-security'
```

Repeat with each exact name rather than a wildcard, run `git worktree prune`,
delete the merged local and remote cycle branches, and verify the root still
contains only its pre-existing `pnpm-workspace.yaml` change. Audit the new
`origin/main` and continue with each residual advisory family in a separate
Issue -> specification PR -> implementation PR cycle.

## Local execution evidence

- Boundary baseline: commit `a99f474` added one Mermaid application-boundary
  characterization. `mermaidCleanup.spec.ts` passed 2/2 on
  `mermaid@11.15.0 -> dompurify@3.4.5`, proving strict initialization,
  normalized render input, returned SVG insertion, localized failure/fallback,
  and scratch cleanup on both paths.
- Dependency RED: commit `f546ac0` added the package-anchored security
  contract. The resolver reached DOMPurify 3.4.5 through Mermaid and failed
  only the 3.4.11 floor assertion with comparison result `-6`; Prettier, ESLint,
  and web TypeScript compilation passed.
- Dependency GREEN: commit `7eb7427` changed only `pnpm-lock.yaml`, with four
  additions and four deletions across three hunks. Frozen pnpm 9 installation
  resolves Mermaid 11.15.0 to DOMPurify 3.4.12. The contract passed 1/1 and
  the focused set passed 5/5 files and 45/45 tests.
- Local gates: frozen install, clean typecheck, typecheck, lint, all 104 files
  / 544 tests, and the workspace build passed. Vite transformed 8,777 modules.
- Timing diagnosis: one parallel-review full-suite run timed out in the
  existing Mermaid-heavy `ArtifactPanel` case. Its focused 6/6 rerun and the
  next serial 104/104-file / 544/544-test run passed without a code change.
- Clean reconstruction: target validation succeeded, all five install paths
  were absent after scoped long-path cleanup, and offline frozen install
  recreated 1,071 packages. Clean typecheck, focused 5/45, and full 104/544
  passed again with clean tracked status.
- Audit: the official registry changed from 7 moderate / 4 low to 2 moderate /
  1 low across 654 production dependencies, with zero critical, zero high,
  and zero DOMPurify records. Residual findings belong to React Router,
  js-yaml, and esbuild.

Exact remote-head verification, independent complete-diff review, and native
Windows/macOS/Linux release validation remain integration gates. Record their
immutable SHA, review result, run ID, artifact sizes, and annotation counts on
the implementation PR before marking it ready.
