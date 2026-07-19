# HTTP Client Dependency Security Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Patch the direct Axios and Undici production dependency lines and prevent frozen installs from returning to their vulnerable resolutions.

**Architecture:** Raise explicit compatible version floors in the owning package manifests and let pnpm produce the affected lockfile graph. Verify the real installed workspace packages through package-anchored `createRequire` calls, then use the official npm audit endpoint as a separate network security gate.

**Tech Stack:** pnpm 9 frozen lockfile, Node.js 24, TypeScript, Vitest, npm advisory API

---

## Implementation branch prerequisite

Merge specification PR #23 before starting implementation. Fetch the resulting
`origin/main`, verify it contains the merged specification, and create the
implementation branch directly from that updated remote head. Do not branch
from the specification branch or from a stale local `main`.

### Task 1: Add the offline dependency contract

**Files:**
- Create: `packages/core/src/__tests__/httpClientDependencies.spec.ts`
- Inspect: `packages/core/package.json`
- Inspect: `packages/web/package.json`
- Inspect: `pnpm-lock.yaml`

**Step 1: Read manifests and installed package metadata**

Resolve the workspace root from the test file URL. Parse the core and web
package manifests with `JSON.parse`. Create package-anchored `require`
functions with `createRequire` so `axios/package.json` resolves from web and
`undici/package.json` resolves from core under pnpm's strict layout.

**Step 2: Express the security floors**

Assert the direct manifest ranges are `^1.16.0` for Axios and `^6.27.0` for
Undici. Compare the three numeric stable-version components from installed
package metadata and require:

```text
1.16.0 <= axios < 2.0.0
6.27.0 <= undici < 7.0.0
```

Reject malformed or prerelease version strings rather than silently treating
them as safe.

**Step 3: Run the focused test to verify RED**

Run:

```powershell
corepack pnpm exec vitest run packages/core/src/__tests__/httpClientDependencies.spec.ts
```

Expected: FAIL because the current manifests declare `^1.6.7` and `^6.11.0`
and the frozen install resolves Axios 1.15.0 and Undici 6.25.0.

### Task 2: Apply targeted dependency updates

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/core/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `packages/core/src/__tests__/httpClientDependencies.spec.ts`

**Step 1: Update only the two direct dependencies**

Use pnpm's targeted recursive update so manifests declare Axios `^1.16.0` and
Undici `^6.27.0`, and the lockfile selects compatible patched releases. Do not
run a broad recursive or `--latest` workspace update.

**Step 2: Inspect lockfile scope**

Confirm the diff contains only the two direct importer changes and transitive
resolution/integrity changes required by their new package graphs. Investigate
any unrelated importer or major-version movement before continuing.

**Step 3: Run the focused test to verify GREEN**

Run:

```powershell
corepack pnpm exec vitest run packages/core/src/__tests__/httpClientDependencies.spec.ts
```

Expected: PASS with both direct packages on their patched major lines.

### Task 3: Verify security and repository behavior

**Files:**
- Verify: `packages/core/package.json`
- Verify: `packages/web/package.json`
- Verify: `pnpm-lock.yaml`
- Verify: `packages/core/src/__tests__/httpClientDependencies.spec.ts`
- Verify: `plans/2026-07-19-http-client-security-design.md`
- Verify: `plans/2026-07-19-http-client-security.md`

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

Expected: every command exits zero. The workspace reports 101 test files and
522 tests if no concurrent upstream tests are added.

**Step 2: Run the official-registry audit**

Run:

```powershell
corepack pnpm audit --prod --json --registry=https://registry.npmjs.org
```

Parse the JSON even if the command remains non-zero for out-of-scope findings.
Require no Axios or scoped Undici advisories and fewer than the baseline 20
high findings. Record the remaining packages and counts in the PR.

**Step 3: Verify change boundaries**

Require no diff outside the two direct manifests, their lockfile, the test,
and the two plan documents. In particular, application source, other package
manifests, registry configuration, and `.github/workflows/release-desktop.yml`
must remain unchanged.

**Step 4: Commit and push**

Create one English implementation commit that references the dependency
security outcome, then push the implementation branch. Open a draft PR
targeting `main`, link merged specification PR #23, and include `Closes #22`.

### Task 4: Prove the exact remote head and integrate

**Files:**
- Verify only: exact pushed implementation head

**Step 1: Verify a fresh frozen install**

Clone the remote implementation branch into a temporary directory. Run a
frozen install, the focused dependency contract, full test suite, workspace
build, and structured official-registry audit. Confirm the clone remains Git
clean, then remove it.

**Step 2: Verify native release behavior**

Dispatch `.github/workflows/release-desktop.yml` at the exact implementation
head. Require successful Windows, macOS, and Linux package validation, zero
annotations, and non-empty artifacts.

**Step 3: Review and integrate**

Request independent review of the full diff and the audit comparison. Resolve
every valid correctness or scope finding. Add exact-head evidence to the PR,
mark it ready, squash-merge it, and confirm Issue #22 closes and `origin/main`
advances.

**Step 4: Clean and continue**

Remove temporary clones, worktrees, and local/remote cycle branches without
touching the root worktree's pre-existing changes. Continue auditing the new
`origin/main`, with Fastify 5 migration and remaining advisory families kept
as separate candidates.
