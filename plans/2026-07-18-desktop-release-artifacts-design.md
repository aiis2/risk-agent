# Desktop Release Artifact Design

**Issue:** https://github.com/aiis2/risk-agent/issues/7

## Context

The desktop release workflow builds core, server, and web packages, then runs
`pnpm --filter @risk-agent/desktop build` on Windows, macOS, and Linux. The
desktop `build` script is only `tsc -b`; it creates compiled JavaScript under
`packages/desktop/dist` and never invokes electron-builder.

The following upload step searches only for installers under
`packages/desktop/release`. It tolerates an empty match with
`if-no-files-found: warn`, so a tag or manual release can appear green while
delivering no installable artifact. The Windows portable builder compounds the
mismatch by writing its executable to a dynamic
`tmp/npm-desktop-stage-*/release` directory that the workflow does not upload.

## Goals

- Make every release matrix job execute a real platform-specific packaging
  command.
- Fail the workflow rather than publish a false-success release when no
  artifact exists.
- Cover the actual Windows staging output and the stable macOS/Linux release
  output with upload patterns.
- Keep release installs deterministic with the committed pnpm lockfile.
- Exercise the Node 24, Electron 42, and native SQLite packaging path added in
  issue #4.
- Document where each platform writes its release artifacts.

## Non-Goals

- Publishing or editing a GitHub Release.
- Changing tag names, application versions, or update metadata.
- Adding code-signing or notarization credentials.
- Replacing electron-builder or redesigning its package configuration.
- Refactoring desktop runtime behavior unrelated to packaging.

## Options Considered

### 1. Platform-aware packaging in the existing workflow

Use a matrix field for the packaging command. Build the four workspace
packages once, run the Windows standalone staging builder with a `--skip-build`
flag, and run the existing macOS or Linux electron-builder scripts on their
native runners. Upload both known output roots and make missing files fatal.

This is the selected option. It fixes the broken contract without creating a
second release system, reuses the packaging paths already maintained by the
repository, and lets GitHub's native runners exercise each target.

### 2. Only change `build` to `dist`

Calling `pnpm --filter @risk-agent/desktop dist` would invoke electron-builder,
but it would use the same default target on every runner and would bypass the
standalone Windows staging path that includes the packaged server, core, web,
and production dependencies. It would also leave the upload warning behavior
unchanged.

### 3. Build only a Windows portable release

The Windows path has the strongest local validation, but silently dropping the
macOS and Linux matrix would reduce the existing release promise rather than
repair it.

## Detailed Design

### Matrix contract

The matrix remains on `windows-latest`, `macos-latest`, and `ubuntu-latest`, but
each entry also declares a stable artifact label and a packaging command:

- Windows runs `node scripts/build-desktop-release.mjs --skip-build --platform=windows`.
- macOS runs `node scripts/build-desktop-release.mjs --skip-build --platform=macos`.
- Linux runs `node scripts/build-desktop-release.mjs --skip-build --platform=linux`.

Before packaging, the workflow explicitly builds core, server, web, and
desktop output in dependency order. Every native target uses the same concrete
hoisted production stage, avoiding pnpm workspace symlinks that electron-builder
cannot reliably traverse. The release builder accepts `--skip-build` so CI can
reuse the workspace output. Local invocations keep their current behavior and
still build prerequisites by default.

### Artifact contract

The upload action accepts the existing platform extensions from both output
roots:

- `tmp/npm-desktop-stage-*/release/*.exe`
- `tmp/npm-desktop-stage-*/release/*.dmg`
- `tmp/npm-desktop-stage-*/release/*.zip`
- `tmp/npm-desktop-stage-*/release/*.AppImage`
- `tmp/npm-desktop-stage-*/release/*.deb`
- `packages/desktop/release/*.exe`
- `packages/desktop/release/*.dmg`
- `packages/desktop/release/*.zip`
- `packages/desktop/release/*.AppImage`
- `packages/desktop/release/*.deb`

Only top-level installer files are uploaded. In particular, the Windows glob
must not collect executables from electron-builder's `win-unpacked` directory,
which would create an incomplete and misleading artifact bundle.

`if-no-files-found` becomes `error`. This converts the core invariant from a
best-effort warning into a release gate.

### Native runner refinements

The repository's `packageManager` field is the single pnpm version source; the
setup action must not declare a second version. Packaging also uses separate
signed and unsigned steps. Empty signing secrets are never exported as
`CSC_LINK`, because electron-builder interprets that empty value as a local
certificate path. Windows and macOS use independent certificate secrets and
matrix gates; Linux always remains unsigned. The desktop package declares the
repository homepage required by Linux package metadata. Linux artifacts use an
explicit unscoped filename so the scoped npm package name cannot create an
accidental subdirectory in the DEB output path.

Native packages copy the built web application explicitly to
`resources/web-dist`, matching the desktop runtime lookup. Static asset
containment uses platform path semantics rather than a Windows-only separator,
so JavaScript and CSS resolve correctly on macOS and Linux without weakening
directory traversal protection.

### Reproducibility

The install step changes from `--frozen-lockfile=false` to
`--frozen-lockfile`. Release automation must use the exact reviewed dependency
graph rather than mutating resolution state during packaging. The native
release builder follows the same rule by creating a minimal staged workspace
and running `pnpm install --prod --frozen-lockfile
--config.node-linker=hoisted`; it must not run a second lockless npm resolution.
The staged MCP resource is copied once with its own compatible nested
`playwright-core`; overlapping resource mappings are forbidden because Unix
packagers reject duplicate destinations.
The desktop's injected server dependency is refreshed offline after the server
build so a clean install snapshots the generated `dist` entrypoint before the
desktop typecheck and native packaging steps.
This refresh also runs in the builder's default local compilation path, not
only in CI. Package-level Windows, macOS, and Linux distribution scripts all
delegate to the staged builder; direct electron-builder commands cannot bypass
the frozen production graph or macOS architecture isolation.

### Regression coverage

A focused desktop Vitest test reads the workflow as configuration and asserts
the release contract: frozen install, four package builds, all three packaging
commands, both artifact roots, and fatal empty uploads. This test deliberately
checks the small set of operational invariants rather than snapshotting the
entire YAML file. A focused server test exercises both POSIX and Windows asset
containment semantics.

The implementation PR will also dispatch the workflow against its own branch.
The three native jobs are the authoritative packaging validation; a job that
cannot produce its installer is a product problem to fix, not a warning to
skip.

Before upload, each native job validates the unpacked application as well as
the installer list. The gate requires a non-empty platform installer set,
`resources/web-dist/index.html`, and the rebuilt `better_sqlite3.node` module.
The host-compatible unpacked Electron executable must also load that packaged
module and complete an in-memory SQLite query. macOS additionally checks every
targeted native binary architecture, including the package that cannot execute
on the runner host. This catches packages that electron-builder completed but
that cannot serve the UI or open the embedded database at runtime.

electron-builder rebuilds native dependencies in the staged `node_modules`
tree and may hard-link those files into the unpacked application. Building x64
and arm64 from one stage lets the later arm64 rebuild mutate the already-built
x64 application through the shared inode, even when the builder processes run
serially. The macOS release builder therefore copies the frozen production
stage once per architecture, then invokes electron-builder serially against
each independent tree.

## Error Handling And Rollback

If a platform packaging command exits nonzero, that matrix job fails before
upload. If packaging exits zero without producing a supported installer, the
upload step fails. The workflow keeps `fail-fast: false`, allowing all platform
results to be collected in one run.

The change has no runtime or data migration. It can be reverted independently
if the release workflow must be restored while a platform-specific packaging
defect is investigated.

## Verification

1. Add the workflow contract test and record its failures against the current
   TypeScript-only build, mutable install, and warning-only upload.
2. Add `--skip-build` and platform targeting to the native release builder
   without changing default local behavior.
3. Update the workflow matrix, package builds, upload paths, and failure mode.
4. Run the focused test, typecheck, lint, and the full Vitest workspace.
5. Build and validate the Windows portable artifact locally.
6. Push the implementation branch and dispatch `release-desktop.yml` on that
   exact ref.
7. Require successful Windows, macOS, and Linux jobs and inspect uploaded file
   names before merge.

## Acceptance Criteria

- All three matrix jobs execute electron-builder through their intended
  platform packaging path.
- A missing installer fails its matrix job.
- Release dependency installation is frozen.
- The workflow contract test and existing repository checks pass.
- The Windows portable smoke probe passes.
- A branch-scoped workflow dispatch produces non-empty Windows, macOS, and
  Linux artifact bundles.
- The implementation PR closes issue #7.
