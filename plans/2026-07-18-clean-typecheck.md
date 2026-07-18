# Clean Typecheck Dependency Boundary Implementation Plan

**Issue:** https://github.com/aiis2/risk-agent/issues/13

**Goal:** Make the documented root typecheck pass directly after a clean frozen
install by removing desktop's compile-time dependency on generated server
output.

## Task 1: Add A Failing Dependency-Boundary Test

**Files:**
- Create: `packages/desktop/src/__tests__/dependencyBoundary.spec.ts`

Assert the intended direct core dependency/reference, shared-contract import,
server compatibility re-export, absence of desktop server type imports/queries,
and preservation of the runtime server specifier.

Run the focused test and record RED against the spec-updated `main`.

## Task 2: Move Browser Host Contracts To Core

**Files:**
- Create: `packages/core/src/browser/BrowserHostAdapter.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/server/src/browser/BrowserHostAdapter.ts`

Move the interfaces without changing their fields. Export them through core's
public index. Replace the server definition file with a type-only compatibility
re-export so existing server imports remain valid.

## Task 3: Decouple Desktop Types From Server Output

**Files:**
- Modify: `packages/desktop/src/backend.ts`
- Modify: `packages/desktop/src/browserHost/BrowserHostService.ts`
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/tsconfig.json`
- Modify: `pnpm-lock.yaml`

Import Browser Host contracts from core, add the direct workspace dependency
and TypeScript reference, and replace the server package type query with the
minimal local loader interface. Preserve the indirect runtime import string and
the injected server dependency.

Run the focused test and affected desktop/server tests.

## Task 4: Prove The Clean Workflow

Create a clean worktree or clone at the exact implementation head. Run only:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
```

Do not build packages or refresh dependencies between these commands. Record
the direct success as the authoritative acceptance evidence.

## Task 5: Verify Repository Quality

Run sequentially:

```powershell
node node_modules/eslint/bin/eslint.js "packages/*/src/**/*.{ts,tsx}"
node node_modules/vitest/vitest.mjs run --testTimeout=10000
git diff --check
```

Also run the focused dependency-boundary and Browser Host suites separately for
clear evidence.

## Task 6: Verify Native Releases

Push the implementation branch and dispatch `release-desktop.yml` on that exact
ref. Require Windows, macOS, and Linux packaged SQLite probes and artifact
uploads to pass. Reconfirm both macOS native architectures.

## Task 7: Review And Publish

1. Confirm no generated output or temporary clean-clone files are tracked.
2. Commit with an English message and push the implementation branch.
3. Open the implementation PR against the spec-updated `main`, linking issue
   #13 and the specification PR.
4. Request an independent review.
5. Mark ready and squash-merge only after clean, repository, and native gates
   pass.
