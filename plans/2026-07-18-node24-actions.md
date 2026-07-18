# Node 24 GitHub Actions Runtime Implementation Plan

**Issue:** https://github.com/aiis2/risk-agent/issues/10

**Goal:** Move every desktop release bootstrap action to a reviewed Node
24-backed major without changing the release artifact contract.

## Task 1: Add A Failing Workflow Contract

**Files:**
- Modify: `packages/desktop/src/__tests__/releaseWorkflow.spec.ts`

Add a focused test that requires:

- `actions/checkout@v7`
- `pnpm/action-setup@v6`
- `actions/setup-node@v7`
- `actions/upload-artifact@v7`

Reject the corresponding v4 references. Run the focused file and record RED
against `origin/main`.

## Task 2: Upgrade The Workflow Actions

**Files:**
- Modify: `.github/workflows/release-desktop.yml`

Change only the four `uses:` references. Preserve all inputs and surrounding
steps, including Node 24, pnpm caching, frozen installs, signing gates,
packaging commands, validation, upload paths, fatal missing artifacts, and
retention.

Run the focused test again and record GREEN.

## Task 3: Verify Repository Quality

Run sequentially:

```powershell
node node_modules/typescript/bin/tsc -b --pretty
node node_modules/eslint/bin/eslint.js "packages/*/src/**/*.{ts,tsx}"
node node_modules/vitest/vitest.mjs run --testTimeout=10000
git diff --check
```

Expected: typecheck and lint exit zero, all Vitest files pass, and the diff has
no whitespace errors.

## Task 4: Verify Current Native Runners

Push the implementation branch and dispatch:

```powershell
gh workflow run release-desktop.yml --repo aiis2/risk-agent --ref <branch>
```

Require Windows, macOS, and Linux jobs to pass packaged SQLite probes and
artifact uploads. List artifact names and sizes. Inspect run annotations and
logs; fail the cycle if the Node 20 action-runtime warning remains.

## Task 5: Review And Publish

1. Confirm the diff changes only the workflow, focused test, and cycle docs.
2. Commit with an English message and push the implementation branch.
3. Open the implementation PR against the spec-updated `main`, linking issue
   #10 and the specification PR.
4. Request an independent review.
5. Mark the PR ready and squash-merge only after local and native gates pass.
