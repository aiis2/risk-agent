# Runtime Transport Dependency Security Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Patch the transitive Hono and ws runtime lines and prevent frozen installs from returning to their vulnerable resolutions.

**Architecture:** Keep the owning server manifests unchanged because their existing ranges accept the fixed releases. Generate a depth-aware targeted pnpm lock update, retain only the Hono/ws graph, and verify actual installed children through package-anchored resolution from their direct parents.

**Tech Stack:** pnpm 9 frozen lockfile, Node.js 24, TypeScript, Vitest, npm advisory API

---

## Implementation branch prerequisite

Merge this cycle's specification PR before starting implementation. Fetch the
resulting `origin/main`, verify it contains both runtime transport security
plans, and create the implementation branch directly from that updated remote
head. Do not branch from the specification branch or stale local `main`.

## Task 1: Add the offline installed-version contract

**Files:**

- Create: `packages/server/src/__tests__/runtimeDependencySecurity.spec.ts`
- Inspect: `packages/server/package.json`
- Inspect: `pnpm-lock.yaml`

**Step 1: Resolve each package through its owning parent**

Resolve the server manifest from the test file URL and create a root
`createRequire`. Use these ownership pairs:

```text
@modelcontextprotocol/sdk -> hono
@fastify/websocket       -> ws
```

Assert each parent remains a direct server dependency. Resolve the parent's
exported package metadata, create a parent-anchored `require`, and resolve the
child's entry point under pnpm's strict layout.

**Step 2: Find and parse child package metadata**

Walk upward from the child entry point until `package.json` exists and its
parsed `name` equals the child package. Reject a missing manifest, missing
version, prerelease, or malformed semantic version.

Compare numeric stable-version components and require:

```text
4.12.25 <= hono < 5.0.0
8.21.0  <= ws   < 9.0.0
```

**Step 3: Run the focused test to verify RED**

Run:

```powershell
corepack pnpm exec vitest run packages/server/src/__tests__/runtimeDependencySecurity.spec.ts
```

Expected: two assertion failures because the frozen graph resolves Hono
4.12.19 and ws 8.20.0 below their security floors.

## Task 2: Apply the targeted transitive updates

**Files:**

- Modify: `pnpm-lock.yaml`
- Test: `packages/server/src/__tests__/runtimeDependencySecurity.spec.ts`

**Step 1: Generate the candidate graph**

Run:

```powershell
corepack pnpm update hono ws --recursive --depth 100 --lockfile-only
```

Expected compatible resolutions at specification time are Hono 4.12.31 and
ws 8.21.1.

**Step 2: Reduce the lockfile to required nodes**

Retain Hono, ws, and their references from `@hono/node-server`,
`@modelcontextprotocol/sdk`, and `@fastify/websocket`. Exclude unrelated Babel
patch additions, workspace `file:` to `link:` normalization, manifest changes,
and any other re-resolution churn.

**Step 3: Recreate the frozen install**

Run:

```powershell
corepack pnpm install --frozen-lockfile
```

Expected: pnpm accepts the final lockfile without rewriting it.

**Step 4: Run the focused test to verify GREEN**

Run the focused Vitest command from Task 1. Expected: two passing cases with
both installed packages on their patched major lines.

## Task 3: Verify security and repository behavior

**Files:**

- Verify: `pnpm-lock.yaml`
- Verify: `packages/server/src/__tests__/runtimeDependencySecurity.spec.ts`
- Update with evidence: `plans/2026-07-19-runtime-transport-security-design.md`
- Update with evidence: `plans/2026-07-19-runtime-transport-security.md`

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
the workspace reports 102 test files and 524 tests.

**Step 2: Run the structured official-registry audit**

Run:

```powershell
corepack pnpm audit --prod --json --registry=https://registry.npmjs.org
```

Parse the JSON despite its non-zero exit for out-of-scope findings. Require
Hono and ws advisory counts of zero and expected totals of 5 high, 8 moderate,
and 5 low. Record any live-registry change rather than weakening scoped gates.

**Step 3: Verify change boundaries**

Require no diff outside the lockfile, the new server test, and these two plan
documents. In particular, every package manifest, application source file,
registry setting, script, and `.github/workflows/release-desktop.yml` must be
unchanged.

**Step 4: Commit, push, and open the implementation PR**

Create one English implementation commit, push the branch, and open a draft
PR targeting `main`. Link Issue #25 and the merged specification PR, explain
the reason and plan, and include `Closes #25`.

## Task 4: Prove the exact remote head and integrate

**Files:**

- Verify only: exact pushed implementation head

**Step 1: Verify an isolated frozen checkout**

Clone the remote implementation branch into a temporary directory. Run frozen
install, the focused contract, full test suite, workspace build, structured
official audit, and `git status`. Confirm the exact head stays clean, then
remove the clone.

**Step 2: Verify native release behavior**

Dispatch `.github/workflows/release-desktop.yml` at the exact implementation
head. Require successful Windows, macOS, and Linux jobs, three non-empty
artifacts, and zero check-run annotations.

**Step 3: Review and integrate**

Request independent review of the complete diff and audit comparison. Resolve
every valid correctness or scope finding. Add exact-head evidence to the PR,
mark it ready, confirm `CLEAN/MERGEABLE`, squash-merge, and verify Issue #25
closes and `origin/main` advances.

**Step 4: Clean and continue**

Remove temporary clones, worktrees, and local/remote cycle branches without
touching the root worktree's pre-existing changes. Continue auditing the new
`origin/main`; keep Fastify 5 and other advisory families as separate cycles.

## Local execution evidence

- RED: 2/2 focused cases failed on Hono 4.12.19 and ws 8.20.0 for the expected
  version-floor assertions.
- GREEN: Hono 4.12.31 and ws 8.21.1 resolve through their existing parents;
  the focused contract passes 2/2.
- Lock scope: 11 additions and 11 removals, with unrelated Babel and workspace
  link normalization removed.
- Audit: `7 high / 17 moderate / 5 low` became
  `5 high / 8 moderate / 5 low`; Hono and ws scoped counts are zero.
- Local gates: frozen install, offline frozen install, clean typecheck,
  typecheck, lint, 102 files / 524 tests, workspace build, and diff checks pass.

Exact pushed-head verification, independent review, and the three native
release jobs remain integration gates and are recorded on the implementation
PR rather than claimed by this local evidence section.
