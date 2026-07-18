# Desktop Release Artifact Implementation Plan

**Issue:** https://github.com/aiis2/risk-agent/issues/7

**Goal:** Make the desktop release workflow produce and upload real native
installers on every matrix runner, with an empty artifact set treated as a
failure.

## Task 1: Add A Failing Workflow Contract Test

**Files:**
- Create: `packages/desktop/src/__tests__/releaseWorkflow.spec.ts`

**Step 1: Encode the release invariants**

Read `.github/workflows/release-desktop.yml` from the repository root and assert
that it contains:

- `pnpm install --frozen-lockfile`
- explicit core, server, web, and desktop build commands
- the Windows `--skip-build` staging command
- the macOS and Linux distribution commands
- upload patterns for the staging and desktop release roots
- `if-no-files-found: error`

Keep assertions focused on commands and paths; do not snapshot the full file.

**Step 2: Run the focused test and record RED**

Run:

```powershell
corepack pnpm --filter @risk-agent/desktop test -- releaseWorkflow.spec.ts
```

Expected: failures show the current mutable install, TypeScript-only desktop
build, missing Windows staging upload, and warning-only empty artifact policy.

## Task 2: Avoid Duplicate Windows Workspace Builds

**Files:**
- Modify: `scripts/build-desktop-portable.mjs`

**Step 1: Add an opt-in skip flag**

Recognize `--skip-build` in `main()`. Only bypass
`buildWorkspacePackages()` when that flag is present. Preserve the current
default and the independent `--validate` option.

**Step 2: Verify default and CI modes**

Use a pinned pnpm 9 environment. Confirm a normal local invocation still builds
prerequisites, while the workflow command can reuse already-built output.

## Task 3: Make The Workflow Package Each Platform

**Files:**
- Modify: `.github/workflows/release-desktop.yml`

**Step 1: Extend the matrix**

Replace the bare OS list with three include entries carrying `artifact_name`
and `package_command` values for Windows, macOS, and Linux.

**Step 2: Freeze dependency installation**

Change the install command to:

```powershell
pnpm install --frozen-lockfile
```

**Step 3: Build all workspace outputs once**

Build core, server, web, and desktop in that order before packaging.

**Step 4: Run the matrix packaging command**

Run the static `matrix.package_command` value. The commands must be the Windows
staging builder with `--skip-build`, `pnpm build:mac`, and `pnpm build:linux`.

**Step 5: Enforce the artifact contract**

Upload the supported installer extensions from both output roots, name the
bundle with `matrix.artifact_name`, and set `if-no-files-found: error`.

## Task 4: Document Release Outputs

**Files:**
- Modify: `README.md`

Add a concise desktop release subsection that identifies the local Windows
portable command, platform output roots, and the fact that automation fails on
an empty artifact set. Do not document signing secrets or internal CI details.

## Task 5: Verify Locally

**Step 1: Run focused and repository checks**

Run sequentially:

```powershell
corepack pnpm --filter @risk-agent/desktop test -- releaseWorkflow.spec.ts
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
git diff --check
```

Expected: the focused test turns GREEN and all existing checks pass.

**Step 2: Build and validate Windows portable output**

Run the portable staging builder with validation in an ASCII staging path when
the local electron-builder NSIS version cannot resolve the Unicode workspace
path. The produced executable must pass `validate-desktop-portable.mjs`.

## Task 6: Verify The Native GitHub Runners

After pushing the implementation branch, dispatch the workflow on that exact
ref:

```powershell
gh workflow run release-desktop.yml --repo aiis2/risk-agent --ref <branch>
```

Wait for the run, inspect all three jobs, and list artifact names and sizes.
Do not merge while any platform job fails or uploads no supported installer.

## Task 7: Review And Publish

1. Review the diff for unrelated workflow, packaging, or dependency changes.
2. Commit with an English message and push the implementation branch.
3. Open the implementation PR against `main`, link the spec PR, include RED and
   GREEN evidence, and close issue #7.
4. Request an independent code review.
5. Mark the PR ready and squash-merge only after local and native-runner gates
   pass.
