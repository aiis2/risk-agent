# Node.js 24 Runtime Baseline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move Risk Agent from its EOL Node.js 20 baseline to Node.js 24 LTS and restore compiler-free SQLite installation on supported platforms.

**Architecture:** Update the repository's runtime contract at every entry point, then upgrade only the native SQLite dependency and Node.js type declarations needed for that contract. Keep storage code and pnpm unchanged, and use clean-install plus existing storage tests as the compatibility boundary.

**Tech Stack:** Node.js 24 LTS, pnpm 9, TypeScript, Vitest, better-sqlite3, Docker, GitHub Actions

---

### Task 1: Capture The Current Runtime Failure

**Files:**
- Inspect: `package.json`
- Inspect: `packages/core/package.json`
- Inspect: `pnpm-lock.yaml`

**Step 1: Confirm the advertised range includes Node.js 24**

Run:

```powershell
node --version
rg -n '"node": ">=20"|better-sqlite3@11\.10\.0' package.json pnpm-lock.yaml
```

Expected: Node.js 24 is active, the engine claims `>=20`, and the lockfile uses
`better-sqlite3@11.10.0`.

**Step 2: Reproduce the clean install failure**

Run in the isolated implementation worktree:

```powershell
corepack pnpm install --frozen-lockfile
```

Expected before the fix: installation reports no Node.js 24 prebuild for
`better-sqlite3@11.10.0` and attempts `node-gyp`. On Windows without the Visual
Studio C++ workload, it exits nonzero.

**Step 3: Record RED evidence**

Include the active Node version, missing-prebuild message, and exit code in the
implementation PR without committing logs or generated files.

### Task 2: Align The Runtime Surfaces

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `.github/workflows/release-desktop.yml`
- Modify: `packages/server/Dockerfile`

**Step 1: Update the root engine**

Change:

```json
"node": ">=24 <25"
```

**Step 2: Update user documentation**

Change the README requirement from Node.js 20 or newer to Node.js 24 LTS. Keep
the existing pnpm 9 and Corepack instructions unchanged.

**Step 3: Update release automation**

Set `actions/setup-node` to `node-version: 24` without changing signing,
artifact, or matrix behavior.

**Step 4: Update both Docker stages**

Change only the base tags from `node:20-alpine` to `node:24-alpine`.

### Task 3: Upgrade The Runtime Dependencies

**Files:**
- Modify: `package.json`
- Modify: `packages/core/package.json`
- Modify: `packages/server/package.json`
- Modify: `packages/desktop/package.json`
- Modify: `pnpm-lock.yaml`

**Step 1: Update better-sqlite3**

Change the core dependency to:

```json
"better-sqlite3": "^12.11.1"
```

**Step 2: Align Node.js types**

In every manifest that currently declares `@types/node`, use:

```json
"@types/node": "^24.13.0"
```

**Step 3: Update the lockfile with an editor patch**

Update only:

- all affected importer specifiers and resolved versions;
- the `better-sqlite3@12.11.1` package and snapshot keys;
- the `@types/node@24.x` package and snapshot keys;
- the matching `undici-types` entry if required by `@types/node`.

Use registry metadata to populate exact integrity and dependency fields. Do not
run a package-manager command that rewrites repository files, and do not update
unrelated snapshots.

**Step 4: Prove lockfile consistency**

Run:

```powershell
corepack pnpm install --frozen-lockfile
```

Expected: exit code 0 and no tracked file changes.

### Task 4: Verify Native And Storage Behavior

**Files:**
- Test: `packages/core/src/storage/embedded/sqlite/SQLiteStore.ts`
- Test: `packages/core/src/storage/**/__tests__/*.spec.ts`

**Step 1: Run a real native smoke test**

Run:

```powershell
node -e "const Database=require('better-sqlite3');const db=new Database(':memory:');db.exec('CREATE TABLE smoke(id INTEGER)');db.prepare('INSERT INTO smoke VALUES (?)').run(1);if(db.prepare('SELECT id FROM smoke').get().id!==1)process.exit(1);db.close();"
```

Expected: exit code 0.

**Step 2: Run focused SQLite storage tests**

Run the existing tests that exercise SQLiteStore and StorageBackendRegistry.
Expected: all focused tests pass with the real native module.

**Step 3: Run full static checks**

Run:

```powershell
node node_modules/typescript/bin/tsc -b --pretty
node node_modules/eslint/bin/eslint.js "packages/*/src/**/*.{ts,tsx}"
```

Expected: both exit 0.

**Step 4: Run the full test workspace**

Run:

```powershell
node node_modules/vitest/vitest.mjs run
```

Expected: all test files pass, including the package-manager portability test
from issue #1.

**Step 5: Run the full build**

Run:

```powershell
node scripts/build.mjs
```

Expected: core, server, and web builds exit 0.

**Step 6: Verify Docker when available**

Run:

```powershell
docker build -f packages/server/Dockerfile -t risk-agent:node24-smoke .
```

Expected: the image builds successfully. If Docker is unavailable, report that
verification gap explicitly rather than claiming it passed.

### Task 5: Audit And Publish

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `.github/workflows/release-desktop.yml`
- Modify: `packages/server/Dockerfile`
- Modify: `packages/core/package.json`
- Modify: `packages/server/package.json`
- Modify: `packages/desktop/package.json`
- Modify: `pnpm-lock.yaml`

**Step 1: Scan for stale runtime references**

Run:

```powershell
rg -n 'node:20|node-version: 20|Node\.js 20|"node": ">=20"|"@types/node": "\^20' README.md package.json packages .github pnpm-lock.yaml
```

Expected: no runtime-baseline matches. Historical or transitive engine metadata
inside the lockfile must be reviewed rather than blindly changed.

**Step 2: Review dependency scope**

Run:

```powershell
git diff --check
git diff --stat
git diff -- package.json packages/core/package.json packages/server/package.json packages/desktop/package.json pnpm-lock.yaml
```

Expected: no whitespace errors and no unrelated dependency churn.

**Step 3: Commit**

Stage only the eight intended files and commit:

```powershell
git commit -m "build: move runtime baseline to Node 24"
```

**Step 4: Push and open the implementation PR**

Push the implementation branch, open a PR against `main`, link the spec PR,
include RED/GREEN install evidence, and close issue #4 on merge.

### Review Adjustment: Align The Embedded Desktop Runtime

Independent review found that Electron 30.5.1 embeds Node.js 20.16.0. Keeping
that version while compiling desktop code against Node.js 24 declarations would
leave the shipped application outside the stated runtime contract and could
turn compile-time success into runtime failures for Node.js 24-only APIs.

**Files:**
- Modify: `packages/desktop/package.json`
- Modify: `scripts/build-desktop-release.mjs`
- Modify: `pnpm-lock.yaml`

**Step 1: Record the failing runtime check**

Run the installed Electron executable with `ELECTRON_RUN_AS_NODE=1` and print
`process.versions`. Expected before the correction: Electron 30.5.1 reports
Node.js 20.16.0.

**Step 2: Upgrade and align Electron**

Set the desktop dependency and portable staging configuration to Electron
42.7.0. This release embeds Node.js 24.18.0 and uses ABI 146, for which
`better-sqlite3@12.11.1` publishes prebuilt binaries. Electron 43 was rejected
because its ABI 148 would require local C++ compilation. Update only the
Electron-related lockfile snapshots.

**Step 3: Verify the embedded runtime and regressions**

Repeat the runtime check. Expected: Electron 42.7.0 reports Node.js 24.18.0.
Then build the real Windows portable artifact to exercise the native SQLite
rebuild, and rerun the frozen install, desktop typecheck/tests, and the full
workspace verification before marking the implementation PR ready.
