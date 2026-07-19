# Fastify Runtime Dependency Security Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the server to patched Fastify and fast-uri runtime lines while preventing frozen installs from returning to the affected graph.

**Architecture:** Extend the existing package-anchored security contract to cover the directly declared Fastify/plugin majors and the distinct fast-uri paths owned by the server. Apply the coordinated Fastify 5 migration and a targeted depth-aware fast-uri refresh, retain only the required manifest/lock graph, and verify supported behavior without speculative application changes.

**Tech Stack:** pnpm 9 frozen lockfile, Node.js 24, TypeScript, Vitest, Fastify 5, npm advisory API

---

## Implementation branch prerequisite

Merge this cycle's specification PR before starting implementation. Fetch the
resulting `origin/main`, verify it contains both Fastify runtime security
plans, and create the implementation branch directly from that updated remote
head. Do not branch from the specification branch or stale local `main`.

## Task 1: Extend the offline runtime dependency contract

**Files:**

- Modify: `packages/server/src/__tests__/runtimeDependencySecurity.spec.ts`
- Inspect: `packages/server/package.json`
- Inspect: `pnpm-lock.yaml`

**Step 1: Add declared-major assertions**

Add table-driven cases for `fastify`, `@fastify/cors`, and
`@fastify/websocket`. Read the server manifest through the existing structured
JSON helper and require a stable caret range whose major is respectively 5,
11, and 11. Reject a missing dependency, prerelease, malformed range, or
different major.

**Step 2: Add direct installed-version assertions**

Resolve each direct package from `createRequire(serverManifestPath)`. First
resolve the exported `<package>/package.json` subpath and walk upward from it
until a manifest with the requested `name` is found; if that subpath is not
exported, resolve the package entry point and perform the same named upward
walk. Parse the stable version and enforce:

```text
5.8.3  <= fastify            < 6.0.0
11.0.0 <= @fastify/cors      < 12.0.0
11.0.0 <= @fastify/websocket < 12.0.0
```

**Step 3: Add package-chain resolution for fast-uri**

Create a metadata-first helper that starts with an anchored `require`, resolves
`<package>/package.json`, and walks upward from that resolved path to the
manifest whose `name` matches the requested package. Fall back to entry-point
resolution plus the same upward walk only when the metadata subpath cannot be
resolved. Return both the parsed manifest and its path so the next
`createRequire` can be anchored there. This handles the SDK wildcard that
maps the metadata subpath to a nameless `dist/cjs/package.json` without ever
resolving its missing default CommonJS entry, while preserving support for
packages such as Hono that do not export package metadata.

Exercise every current production chain reported by
`pnpm why fast-uri --prod --depth 20`:

```text
@modelcontextprotocol/sdk -> ajv -> fast-uri
@modelcontextprotocol/sdk -> ajv-formats -> ajv -> fast-uri
fastify -> @fastify/ajv-compiler -> fast-uri
fastify -> @fastify/ajv-compiler -> ajv -> fast-uri
fastify -> @fastify/ajv-compiler -> ajv-formats -> ajv -> fast-uri
fastify -> @fastify/fast-json-stringify-compiler -> fast-json-stringify -> fast-uri
fastify -> @fastify/fast-json-stringify-compiler -> fast-json-stringify -> ajv -> fast-uri
fastify -> @fastify/fast-json-stringify-compiler -> fast-json-stringify -> ajv-formats -> ajv -> fast-uri
fastify -> fast-json-stringify -> fast-uri
fastify -> fast-json-stringify -> ajv -> fast-uri
fastify -> fast-json-stringify -> ajv-formats -> ajv -> fast-uri
```

Require every terminal fast-uri version to be stable and `>=3.1.2`. The
official-registry audit in Task 4 must still report zero fast-uri records so a
new path cannot escape merely because it is absent from the static table.

**Step 4: Run the focused test to verify RED**

Run:

```powershell
corepack pnpm exec vitest run packages/server/src/__tests__/runtimeDependencySecurity.spec.ts
```

Expected: the two existing Hono/ws cases pass; the new direct cases fail on
Fastify 4.29.1, CORS 9.0.1, and WebSocket 10.0.1; the fast-uri cases fail on
2.4.0 or 3.1.0. Save the complete RED output before changing any manifest or
lockfile.

## Task 2: Capture websocket compatibility before the plugin migration

**Files:**

- Create: `packages/server/src/__tests__/websocket.spec.ts`
- Inspect: `packages/server/src/index.ts`
- Inspect: `packages/server/src/ws/AgentProgressHandler.ts`
- Inspect: `packages/server/src/ws/storageEventBus.ts`

**Step 1: Write the real application characterization**

Create a temporary data directory with `mkdtempSync`, call `buildApp` with
port zero, and await `app.ready()`. Connect to `/api/ws/storage` through
`app.injectWS`, recording the storage event bus's listener count before the
connection and asserting that it increases by one. Register a one-shot
message promise, and call
`publishStorageEvent('storage-validation-finished', { ok: true })`.

Decode the received message and assert at least:

```text
type = storage-validation-finished
data.ok = true
```

Create the socket close promise before terminating it, await that close event,
and assert the storage event bus's listener count returns to its pre-connection
value. Close the app and remove the temporary directory in a `finally` block
so a failure cannot leak runtime data or listeners.

**Step 2: Run the focused test to capture the baseline**

Run:

```powershell
corepack pnpm exec vitest run packages/server/src/__tests__/websocket.spec.ts
```

Expected: one passing characterization case on Fastify 4/plugin 10. No
production source changes are allowed in this step.

## Task 3: Apply the coordinated runtime migration

**Files:**

- Modify: `packages/server/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `packages/server/src/__tests__/runtimeDependencySecurity.spec.ts`

**Step 1: Generate the compatible direct graph**

Run:

```powershell
corepack pnpm --filter @risk-agent/server update fastify@^5.10.0 @fastify/cors@^11.3.0 @fastify/websocket@^11.3.0
```

Expected direct resolutions are Fastify 5.10.0 and both plugins at 11.3.0.

**Step 2: Refresh vulnerable fast-uri paths**

Run:

```powershell
corepack pnpm update fast-uri --recursive --depth 100 --lockfile-only
```

Expected terminal resolutions are fast-uri 3.1.4 through AJV/compiler paths
and 4.1.1 through `fast-json-stringify@7.0.1`.

**Step 3: Reduce the generated diff to required nodes**

Retain the three direct ranges, their importer resolutions, the coherent
Fastify 5 closure, and the fast-uri replacements. Remove unrelated Babel
7.29.7 additions and testing-library reference changes. Restore the base
`@risk-agent/core@file:packages/core` package/snapshot and the injected server
snapshot's `file:packages/core` dependency instead of pnpm's generated
`link:` normalization.

Run `git diff --check` and inspect every remaining lock hunk. Each retained
hunk must trace to Fastify, one of its plugins, their runtime closure, or a
scoped fast-uri owner.

**Step 4: Recreate the frozen install**

Run:

```powershell
corepack pnpm install --frozen-lockfile
```

Expected: pnpm accepts the reduced lockfile without rewriting it.

**Step 5: Run the focused tests to verify GREEN and compatibility**

Run the focused Vitest commands from Tasks 1 and 2. Expected: all existing and
new dependency contract cases pass, and the real websocket event round trip
remains green on Fastify 5/plugin 11.

## Task 4: Verify security and repository behavior

**Files:**

- Verify: `packages/server/package.json`
- Verify: `pnpm-lock.yaml`
- Verify: `packages/server/src/__tests__/runtimeDependencySecurity.spec.ts`
- Verify: `packages/server/src/__tests__/websocket.spec.ts`
- Update with evidence: `plans/2026-07-19-fastify-runtime-security-design.md`
- Update with evidence: `plans/2026-07-19-fastify-runtime-security.md`

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
the workspace reports 102 existing test files / 524 existing tests plus the
new contract cases.

**Step 2: Prove a subsequent offline frozen install**

Remove only this implementation worktree's generated install state using the
established Windows reparse-point cleanup procedure, then run:

```powershell
corepack pnpm install --offline --frozen-lockfile
corepack pnpm typecheck:clean
corepack pnpm typecheck
corepack pnpm test
```

Expected: the checked-in graph can be recreated from the pnpm store without
network resolution and the clean compiler/test gates still pass.

**Step 3: Run the structured official-registry audit**

Run:

```powershell
corepack pnpm audit --prod --json --registry=https://registry.npmjs.org
```

Parse the JSON despite its non-zero exit for out-of-scope findings. Require
zero critical, zero high, zero Fastify/plugin/fast-uri records, and expected
totals of 7 moderate and 4 low. Record a live-registry change rather than
weakening the scoped gates.

**Step 4: Verify change boundaries**

Require no diff outside the server manifest, lockfile, existing dependency
security test, new websocket compatibility test, and these two plan documents.
If a supported-runtime Fastify 5 regression is found, reproduce it under TDD
and update Issue #28 and both plans before making the smallest required
compatibility change.

**Step 5: Record evidence, commit, push, and open the implementation PR**

Append concise local evidence to both plans. Create one English implementation
commit, push the branch, and open a draft PR targeting `main`. Link Issue #28
and the merged specification PR, explain the reason and plan, and include
`Closes #28`.

## Task 5: Prove the exact remote head and integrate

**Files:**

- Verify only: exact pushed implementation head

**Step 1: Verify an isolated frozen checkout**

Clone the exact remote implementation branch into a temporary directory. Run
frozen install, focused dependency contract, clean typecheck, lint, full test
suite, workspace build, structured official audit, and `git status`. Confirm
the exact head stays clean, then remove the clone.

**Step 2: Verify native release behavior**

Dispatch `.github/workflows/release-desktop.yml` at the exact implementation
head. Require successful Windows, macOS, and Linux jobs, three non-empty
artifacts, and zero check-run annotations.

**Step 3: Review and integrate**

Request independent review of the complete diff and audit comparison. Resolve
every valid correctness or scope finding. Add exact-head evidence to the PR,
mark it ready, confirm `CLEAN/MERGEABLE`, squash-merge, and verify Issue #28
closes and `origin/main` advances.

**Step 4: Clean and continue**

Remove temporary clones, worktrees, and local/remote cycle branches without
touching the root worktree's pre-existing changes. Continue auditing the new
`origin/main`; keep each remaining advisory family in a separate cycle.

## Local execution evidence

- RED: 17 new dependency cases failed on Fastify 4.29.1, CORS 9.0.1,
  WebSocket 10.0.1, and fast-uri 2.4.0/3.1.0; the two existing Hono/ws cases
  passed with no resolver error.
- WebSocket baseline: the real `/api/ws/storage` round trip passed before the
  migration, including listener registration and failure-safe cleanup.
- GREEN: Fastify 5.10.0, CORS/WebSocket 11.3.0, fast-uri 3.1.4/4.1.1, and all
  20 focused dependency/websocket cases pass after the migration.
- Lock scope: the final diff retains only the three direct ranges and coherent
  Fastify 5/runtime closure. Babel, Testing Library, `node-abi`, and injected
  workspace normalization churn were removed; independent lock review found
  no packaging or consistency issue.
- Local gates: frozen install, clean typecheck, typecheck, lint,
  103 test files / 542 tests, and the workspace build pass.
- Timing diagnosis: one concurrent full-suite run timed out in the unrelated
  Mermaid `ArtifactPanel` case; its focused 6/6 run and the next two complete
  103-file / 542-test runs passed without any source change.
- Clean reconstruction: after deleting generated `node_modules`,
  `pnpm install --offline --frozen-lockfile` recreated 1,071 packages; clean
  typecheck, 20 focused cases, and all 103 files / 542 tests passed.
- Audit: `5 high / 8 moderate / 5 low` became
  `0 high / 7 moderate / 4 low` across 654 production dependencies, with zero
  Fastify/plugin/fast-uri records.

Exact pushed-head verification, independent full-diff review, and the native
Windows/macOS/Linux release jobs remain integration gates and are recorded on
the implementation PR rather than claimed by this local evidence section.
