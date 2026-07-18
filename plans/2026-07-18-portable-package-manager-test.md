# Portable Package-Manager Test Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the workstation-specific path from the package-manager write test while preserving real manifest detection and sandbox-policy coverage.

**Architecture:** The existing unit test will create an isolated package workspace with Node filesystem APIs, execute the unchanged production tool against it, and remove the workspace in guaranteed cleanup. No production modules or public interfaces change.

**Tech Stack:** TypeScript, Vitest, Node.js filesystem/path/OS APIs, pnpm workspace

---

### Task 1: Capture The Portability Regression

**Files:**
- Inspect: `packages/core/src/tools/__tests__/DeveloperProbeTools.spec.ts`

**Step 1: Confirm the hard-coded precondition**

Run:

```powershell
rg -n "D:/npm_work/risk_agent" packages/core/src/tools/__tests__/DeveloperProbeTools.spec.ts
```

Expected: one match in the `package_manager_write` test.

**Step 2: Run the focused test before editing**

Run:

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/tools/__tests__/DeveloperProbeTools.spec.ts
```

Expected: FAIL with `ENOENT` for `D:\npm_work\risk_agent\package.json` on a clean machine.

**Step 3: Record the RED evidence in the implementation PR description**

Include the failing test name and expected `ENOENT` reason without committing generated output.

### Task 2: Build A Self-Contained Workspace Fixture

**Files:**
- Modify: `packages/core/src/tools/__tests__/DeveloperProbeTools.spec.ts`

**Step 1: Add only the required Node imports**

Use `mkdtempSync`, `rmSync`, and `writeFileSync` from `node:fs`, `tmpdir` from
`node:os`, and the existing `node:path` import. Match the file's current import
style and do not reformat unrelated imports.

**Step 2: Create the fixture inside the affected test**

Create a unique directory with:

```ts
const packageRoot = mkdtempSync(join(tmpdir(), 'risk-agent-package-manager-write-'));
writeFileSync(
  join(packageRoot, 'package.json'),
  JSON.stringify({ name: 'package-manager-write-fixture', private: true, packageManager: 'pnpm@9.0.0' }),
  'utf8',
);
writeFileSync(join(packageRoot, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n", 'utf8');
```

**Step 3: Guarantee cleanup**

Wrap execution and assertions in `try`/`finally` and remove only the unique
fixture directory:

```ts
finally {
  rmSync(packageRoot, { recursive: true, force: true });
}
```

**Step 4: Keep behavioral assertions unchanged**

The test must still assert `pnpm add lodash --save-dev`, workspace-write access,
and the successful result envelope. Do not weaken assertions to make the test
pass.

### Task 3: Verify The Fix

**Files:**
- Test: `packages/core/src/tools/__tests__/DeveloperProbeTools.spec.ts`

**Step 1: Run the focused suite**

Run:

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/tools/__tests__/DeveloperProbeTools.spec.ts
```

Expected: PASS, 6 tests passed and 0 failed.

**Step 2: Confirm the absolute path is gone**

Run:

```powershell
rg -n "D:/npm_work/risk_agent|D:\\npm_work\\risk_agent" packages/core/src/tools/__tests__/DeveloperProbeTools.spec.ts
```

Expected: no matches.

**Step 3: Run typecheck**

Run:

```powershell
node node_modules/typescript/bin/tsc -b --pretty
```

Expected: exit code 0.

**Step 4: Run lint**

Run:

```powershell
node node_modules/eslint/bin/eslint.js "packages/*/src/**/*.{ts,tsx}"
```

Expected: exit code 0.

**Step 5: Run the broad suite**

Run:

```powershell
node node_modules/vitest/vitest.mjs run
```

Expected: the package-manager write test passes. Any unrelated native-addon
installation failures are reported explicitly and tracked separately rather
than hidden.

### Task 4: Publish The Implementation

**Files:**
- Modify: `packages/core/src/tools/__tests__/DeveloperProbeTools.spec.ts`

**Step 1: Review the final diff**

Run:

```powershell
git diff --check
git diff -- packages/core/src/tools/__tests__/DeveloperProbeTools.spec.ts
```

Expected: no whitespace errors and only the scoped fixture change.

**Step 2: Commit**

```powershell
git add packages/core/src/tools/__tests__/DeveloperProbeTools.spec.ts
git commit -m "test: make package manager fixture portable"
```

**Step 3: Push and open the implementation PR**

Push the branch, open a PR against `main`, link issue #1, include RED/GREEN
evidence, and request that the PR close issue #1 when merged.
