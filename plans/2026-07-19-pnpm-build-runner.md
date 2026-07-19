# Active pnpm Build Runner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the documented workspace build reuse the pnpm CLI selected by its outer lifecycle instead of resolving an unrelated PATH binary.

**Architecture:** Pass the lifecycle's `npm_execpath` to the current Node executable with structured arguments and no shell. Cover the real orchestrator with a fake active CLI so version inheritance, call order, and warning behavior are verified without performing package builds inside the unit test.

**Tech Stack:** Node.js 24 child processes, pnpm 9 lifecycle environment, TypeScript, Vitest

---

### Task 1: Reproduce the package-manager split in a behavioral test

**Files:**
- Create: `packages/core/src/__tests__/buildScript.spec.ts`
- Inspect: `scripts/build.mjs`
- Inspect: `package.json`

**Step 1: Create an isolated fake package-manager CLI**

In the test, create a temporary directory with `mkdtempSync`. Write an ESM
script that appends `process.argv.slice(2)` as JSON to a log path supplied by
the test environment.

Remove all case variants of PATH from the inherited environment before adding
a PATH that contains only the temporary directory. This prevents Windows from
retaining a separate `Path` entry.

**Step 2: Run the real build orchestrator**

Use `spawnSync(process.execPath, [buildScriptPath])` with the isolated PATH,
the fake script in `npm_execpath`, and captured UTF-8 output. Assert exit zero,
three exact argument arrays in core/server/web order, and no `DEP0190` in
stderr. Remove the temporary directory in `finally`.

**Step 3: Run the focused test to verify RED**

Run:

```powershell
corepack pnpm exec vitest run packages/core/src/__tests__/buildScript.spec.ts
```

Expected: FAIL because the current orchestrator ignores `npm_execpath`, looks
up pnpm in the isolated PATH, and exits non-zero.

### Task 2: Reuse the active lifecycle package manager

**Files:**
- Modify: `scripts/build.mjs`
- Test: `packages/core/src/__tests__/buildScript.spec.ts`

**Step 1: Validate the lifecycle entry**

Read `process.env.npm_execpath` once before the build loop. If it is absent,
write a concise error telling the user to run `pnpm build` and exit non-zero.
Do not fall back to a PATH lookup.

**Step 2: Replace the shell child process**

For each existing pnpm argument list, call `spawnSync(process.execPath,
[packageManagerCli, ...args], { stdio: 'inherit' })`. Preserve labels, order,
and immediate failure propagation. Remove the command name from the `steps`
data because it is now constant.

**Step 3: Run the focused test to verify GREEN**

Run:

```powershell
corepack pnpm exec vitest run packages/core/src/__tests__/buildScript.spec.ts
```

Expected: PASS, one test and zero warnings.

**Step 4: Verify direct invocation fails clearly**

Run:

```powershell
node scripts/build.mjs
```

Expected: non-zero with an instruction to use `pnpm build`, without invoking a
PATH package manager.

### Task 3: Verify the repository and exact clean-checkout workflow

**Files:**
- Verify: `scripts/build.mjs`
- Verify: `packages/core/src/__tests__/buildScript.spec.ts`
- Verify: `plans/2026-07-19-pnpm-build-runner-design.md`
- Verify: `plans/2026-07-19-pnpm-build-runner.md`

**Step 1: Run repository quality gates**

Run:

```powershell
corepack pnpm typecheck:clean
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
git diff --check
```

Expected: every command exits zero; the workspace reports all 100 test files
and all tests passing.

**Step 2: Prove the real conflicting-PATH build**

From a clean frozen install, record:

```powershell
corepack pnpm --version
pnpm --version
corepack pnpm build
```

Expected: the first two versions differ, while the build completes core,
server, and web without a modules purge or `DEP0190` warning.

**Step 3: Verify protected files are unchanged**

Run:

```powershell
git diff origin/main...HEAD -- package.json packages/*/package.json pnpm-lock.yaml .github/workflows/release-desktop.yml
```

Expected: no output.

**Step 4: Prove the exact-head clean workflow**

Clone the pushed implementation branch into a temporary directory, perform a
frozen install, record both pnpm versions, and run `corepack pnpm build`.
Require exit zero, all three package completions, and no `DEP0190`. Remove the
temporary clone afterward.

**Step 5: Verify native release behavior**

Dispatch `.github/workflows/release-desktop.yml` at the exact implementation
head. Require Windows, macOS, and Linux package validation, zero annotations,
and non-empty artifacts.

**Step 6: Review and integrate**

Request independent review of the complete implementation diff. Resolve every
valid correctness finding, update the implementation PR with exact-head
evidence, mark it ready, and squash-merge it. Confirm Issue #19 closes and
`origin/main` advances to the merge commit.
