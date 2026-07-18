# Clean Workspace Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make a fresh frozen install followed directly by the root Vitest workspace command pass without building core first.

**Architecture:** Give the server Vitest project one package-local, test-only exact alias from `@risk-agent/core` to the core TypeScript source entry. Preserve production package resolution and add a focused configuration contract that detects the regression even when generated output exists.

**Tech Stack:** TypeScript, Vitest 1, Vite 5 resolution, pnpm 9 workspaces, Node.js 24

---

### Task 1: Lock the clean-test resolution contract

**Files:**
- Create: `packages/server/src/__tests__/vitestConfig.spec.ts`
- Inspect: `vitest.workspace.ts`
- Inspect: `packages/server/package.json`
- Inspect: `packages/core/package.json`

**Step 1: Write the failing contract test**

Read `packages/server/vitest.config.ts` with Node's filesystem API. Require the
file to use `defineConfig`, a structured alias array, the exact anchored matcher
`/^@risk-agent\/core$/`, and a URL-derived replacement for
`../core/src/index.ts`.

The test must not create the config or accept an unanchored string alias.

**Step 2: Run the focused test to verify RED**

Run:

```powershell
corepack pnpm exec vitest run packages/server/src/__tests__/vitestConfig.spec.ts
```

Expected: FAIL because `packages/server/vitest.config.ts` does not exist.

**Step 3: Confirm the original failure remains reproducible**

In a clean checkout after frozen install, verify `packages/core/dist` is absent
and run:

```powershell
corepack pnpm exec vitest run packages/server/src/__tests__/builtin-mcp-bootstrap.spec.ts
```

Expected: FAIL while collecting `@risk-agent/core` through its missing
generated entry.

### Task 2: Add the minimal server Vitest resolution boundary

**Files:**
- Create: `packages/server/vitest.config.ts`
- Test: `packages/server/src/__tests__/vitestConfig.spec.ts`

**Step 1: Define the package-local config**

Import `fileURLToPath` from `node:url` and `defineConfig` from `vitest/config`.
Return a config with one structured `resolve.alias` entry. Its `find` value must
be `/^@risk-agent\/core$/`, and its replacement must resolve
`../core/src/index.ts` relative to the config's `import.meta.url`.

Do not add test hooks, environment options, package export conditions, or
aliases for unrelated packages.

**Step 2: Run the focused contract test to verify GREEN**

Run:

```powershell
corepack pnpm exec vitest run packages/server/src/__tests__/vitestConfig.spec.ts
```

Expected: PASS, one test and zero failures.

**Step 3: Verify source resolution with generated output absent**

Clean TypeScript build output, confirm `packages/core/dist` is absent, then run:

```powershell
corepack pnpm typecheck:clean
corepack pnpm exec vitest run packages/server/src/__tests__/builtin-mcp-bootstrap.spec.ts packages/server/src/__tests__/buildHarnessRuntime.spec.ts
```

Expected: both files pass without a core build.

### Task 3: Verify the repository and exact clean-checkout workflow

**Files:**
- Verify: `packages/server/vitest.config.ts`
- Verify: `packages/server/src/__tests__/vitestConfig.spec.ts`
- Verify: `plans/2026-07-18-clean-tests-design.md`
- Verify: `plans/2026-07-18-clean-tests.md`

**Step 1: Run repository quality gates**

Run:

```powershell
corepack pnpm typecheck:clean
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
git diff --check
```

Expected: every command exits zero; the full workspace reports all 98 test
files and all tests passing.

**Step 2: Verify manifests and lockfile are unchanged**

Run:

```powershell
git diff origin/main...HEAD -- package.json packages/*/package.json pnpm-lock.yaml
```

Expected: no output.

**Step 3: Prove the exact-head clean workflow**

Clone the pushed implementation branch into a temporary directory and run:

```powershell
corepack pnpm install --frozen-lockfile
Test-Path packages/core/dist
corepack pnpm test
```

Expected: `Test-Path` prints `False`; all workspace tests pass without running
a build first. Remove the temporary clone afterward.

**Step 4: Verify native release behavior**

Dispatch `.github/workflows/release-desktop.yml` at the exact implementation
head. Require Windows, macOS, and Linux to pass package validation, report zero
check annotations, and upload non-empty artifacts.

**Step 5: Review and integrate**

Request an independent review of the complete implementation diff. Resolve all
correctness findings, update the implementation PR with exact-head evidence,
mark it ready, and squash-merge it. Confirm Issue #16 closes and `origin/main`
advances to the merge commit.
