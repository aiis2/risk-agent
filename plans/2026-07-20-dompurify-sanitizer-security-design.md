# DOMPurify Sanitizer Security Design

## Context

Issue #31 records the production dependency audit baseline on
`origin/main@31b4a660347ea7dab3e06af2262bcd4e067ef7d0`. A frozen install
passes clean typecheck, typecheck, lint, 103 test files / 542 tests, and the
workspace build, but an official-registry production audit reports 7
moderate and 4 low findings across 654 dependencies.

Eight of the eleven records belong to one web runtime path:

```text
@risk-agent/web -> mermaid@11.15.0 -> dompurify@3.4.5
```

Those records contain five moderate and three low findings. Their affected
ranges require DOMPurify 3.4.11 or newer as the aggregate patched floor.
Mermaid 11.15.0 declares `dompurify@^3.3.1`, so it already permits a patched
3.x release.

A disposable targeted trial resolved DOMPurify 3.4.12 without changing any
manifest or application source. The official-registry production audit then
reported 2 moderate and 1 low finding, with no DOMPurify record. Frozen
install, the four existing Mermaid-facing test files / 43 tests, clean
typecheck, typecheck, lint, the complete 103-file / 542-test suite, and the
workspace build all passed.

DOMPurify is on a real rendering boundary. Chat and artifact Mermaid source
is passed to `mermaid.render()` after Mermaid is initialized with
`securityLevel: 'strict'`. Mermaid sanitizes the generated SVG, and the
returned SVG is inserted into the page through `dangerouslySetInnerHTML`.

The application does not visibly use DOMPurify's `IN_PLACE` mode or persistent
`setConfig` behavior, and no advisory exploit precondition was reproduced.
The security case therefore relies on the official affected ranges and the
actual sanitizer boundary rather than claiming a locally reproduced exploit.

## Goals

- Resolve every production `mermaid -> dompurify` path to a stable version at
  or above 3.4.11 and below 4.0.0.
- Remove every DOMPurify record from the official npm production audit.
- Add a deterministic, network-free installed-graph contract anchored through
  the package that owns DOMPurify.
- Add a passing pre-refresh characterization of strict Mermaid initialization,
  successful SVG insertion, render failure handling, and scratch-node cleanup.
- Preserve Mermaid 11.15.0, strict rendering, scratch-node cleanup, chat
  rendering, artifact rendering, and release packaging behavior.
- Limit the lockfile diff to the DOMPurify package/snapshot replacement and
  Mermaid snapshot reference.

## Non-goals

- Upgrading Mermaid or changing its configuration.
- Adding application sanitization code or changing the SVG insertion path.
- Reproducing or claiming every upstream exploit precondition.
- Fixing React Router, js-yaml, esbuild, or another independent advisory
  family in this cycle.
- Adding a global override, changing package manifests, or refreshing the
  broader workspace graph.
- Refactoring Mermaid rendering, cleanup, chat, artifact, test, build, or
  release code.

## Approaches considered

### 1. Refresh Mermaid's existing DOMPurify child to 3.4.12 (selected)

Keep Mermaid 11.15.0 and all manifests unchanged, replace only the compatible
DOMPurify lock resolution, and protect the installed path with a
package-anchored floor contract.

This removes all eight scoped findings with the smallest runtime, lockfile,
and review surface. The trial proves that the patched child satisfies
Mermaid's existing range and the repository's current behavior gates.

### 2. Upgrade Mermaid

Mermaid already accepts the patched DOMPurify release. Upgrading Mermaid would
expand the diagram parser, renderer, styling, bundle, and compatibility
surface without improving the scoped audit result. It is unnecessary for this
cycle.

### 3. Add a global override or run a broad recursive update

A global override would conceal the current owner relationship and could
affect future unrelated paths. A broad update generated unrelated Babel,
deprecation metadata, Testing Library, and workspace-link movement in the
trial. Neither is required for the one owned production path.

## Dependency contract

The web manifest remains the root of the contract. The test first confirms
that `@risk-agent/web` declares Mermaid, resolves Mermaid from a
`createRequire` anchored at `packages/web/package.json`, and locates the real
Mermaid manifest by walking upward from its resolved entry point.

The test then confirms that Mermaid declares DOMPurify, re-anchors
`createRequire` at the resolved Mermaid manifest, resolves the DOMPurify entry
point, and walks upward until it finds a manifest whose `name` is
`dompurify`. This follows the actual pnpm runtime graph rather than relying on
a root-hoisted package or parsing `pnpm-lock.yaml` as text.

DOMPurify does not export `dompurify/package.json`, so entry-point resolution
plus the named upward walk is required. The resulting manifest version must
be a stable `major.minor.patch` value satisfying:

```text
3.4.11 <= mermaid -> dompurify < 4.0.0
```

The contract intentionally uses a floor and major ceiling rather than pinning
3.4.12 forever. A compatible future lock refresh may move to another stable
3.x patch, while a regression to an affected release or an unreviewed major
change fails offline.

## Regression test

Before adding the failing dependency floor, extend
`packages/web/src/components/Chat/__tests__/mermaidCleanup.spec.ts` with one
passing application-boundary characterization. Mock the dynamically imported
Mermaid module, render `ResponseContent` in jsdom, and prove that the
application:

- initializes Mermaid with `startOnLoad: false` and `securityLevel: 'strict'`;
- passes the normalized chart and generated render ID to `mermaid.render()`;
- inserts the returned SVG into the rendered response;
- presents the render error and chart fallback when Mermaid rejects; and
- removes body-level scratch nodes on both success and failure.

This test characterizes the application's use of the Mermaid sanitizer
boundary. It does not claim to reproduce DOMPurify internals. Record it as
GREEN on DOMPurify 3.4.5 and retain it unchanged through the dependency
refresh.

Create
`packages/web/src/__tests__/runtimeDependencySecurity.spec.ts`. Keep its
small package resolver local to the web tests rather than coupling web runtime
security to the server test suite.

The test uses structured package metadata, a strict stable-version parser,
and numeric tuple comparison. It does not add `semver`, which is not a direct
root or web dependency.

On the specification-merged base, the new case must fail with the installed
DOMPurify 3.4.5 below the 3.4.11 floor. The resolver and Mermaid declaration
checks must succeed so the RED result proves the intended vulnerable version
rather than a path or test setup error.

After the lock refresh, the same case must resolve DOMPurify 3.4.12 and pass
both the floor and `<4` ceiling. Run it with the existing Mermaid-facing
coverage:

```text
packages/web/src/components/Chat/__tests__/mermaidCleanup.spec.ts
packages/web/src/components/Chat/__tests__/responseContent.spec.ts
packages/web/src/components/Runs/__tests__/ArtifactPanel.spec.tsx
packages/web/src/pages/__tests__/Chat.spec.tsx
```

The focused result is expected to move from four files / 43 tests to five
files / 45 tests: one new boundary characterization in an existing file and
one new dependency case in a new file.

## Manifest and lockfile update

Do not change `packages/web/package.json` or another manifest. Apply the
verified targeted lock replacement through the editor:

- replace the `dompurify@3.4.5` package node and integrity with 3.4.12;
- replace the DOMPurify snapshot key with 3.4.12;
- update Mermaid's snapshot dependency reference from 3.4.5 to 3.4.12.

The logical change is eight diff lines across three hunks. Reject Babel patch
additions, deprecation metadata, Testing Library references, workspace
`file:`/`link:` normalization, or any other package movement. A frozen install
must accept the edited graph without rewriting the lockfile.

The verified 3.4.12 integrity is:

```text
sha512-zQvGet8Z2sWbQhCmfFz/T5QWH2oBmjnqK3qvOjaqaNLrLEF912WamU+ohnTp0TCep/MFVHpdJuCZEdFOdTnEFg==
```

## Mermaid behavior boundary

No production source change is planned. The new application-boundary
characterization directly protects:

- Mermaid initialization with strict security settings;
- successful and failed chart rendering in response content;
- cleanup of scratch nodes created outside the component tree;

The existing tests continue to protect:

- chat message rendering and lifecycle behavior;
- artifact Mermaid rendering and cleanup.

If the patched sanitizer changes a supported behavior, first capture the
specific failure with a focused test. Make no application workaround unless
that failure is reproduced. If a required compatibility change expands beyond
the bounded dependency refresh, stop and split it into a separate issue.

## Audit verification

Run the network security gate explicitly against the official registry:

```powershell
corepack pnpm audit --prod --json --registry=https://registry.npmjs.org
```

The configured mirror does not expose the audit endpoint. An endpoint failure
is not a clean result. Parse the JSON even though the command exits non-zero
for independent findings. Require zero critical, zero high, zero DOMPurify
records, and residual totals no worse than the reproduced 2 moderate and 1
low. A stricter result is acceptable with an explanation. A worse live result
blocks completion until Issue #31 and both plans are updated and independently
re-reviewed; it must not be silently accepted as an unrelated registry change.

## Failure handling

If package-anchored resolution cannot reach DOMPurify, inspect the installed
Mermaid manifest and entry point rather than falling back to root resolution
or lockfile text parsing. The contract must prove the runtime-owned path.

If a frozen install rewrites the lockfile, compare it with the verified trial
and retain only changes required for the 3.4.12 child. Do not hide unexpected
movement behind an override.

If a Mermaid-facing test fails after the refresh, reproduce the smallest
supported behavior change before modifying source. Do not weaken the security
floor or remove existing assertions to make the graph pass.

## Verification

1. Record the Mermaid application-boundary characterization GREEN on
   DOMPurify 3.4.5.
2. Record the package-anchored dependency test RED on DOMPurify 3.4.5.
3. Apply only the verified DOMPurify 3.4.12 lock replacement and run a frozen
   install without lockfile rewrite.
4. Record dependency GREEN and run all five focused Mermaid-facing files.
5. Run clean typecheck, typecheck, lint, the full test suite, workspace build,
   diff checks, and a subsequent offline frozen install.
6. Parse the official-registry audit and compare it with the 7 moderate / 4
   low baseline.
7. Verify no manifest, application source, unrelated dependency, script,
   workflow, registry, or release movement entered the diff.
8. Complete independent specification and code-quality review, resolve every
   valid finding, push any correction, and then freeze the expected remote SHA.
9. Clone that exact pushed head and repeat frozen install, focused/full tests,
   build, structured audit, and clean-status checks.
10. Run Windows, macOS, and Linux native desktop packaging at that same SHA;
    require three non-empty artifacts and zero annotations.

## Acceptance criteria

- Every production `mermaid -> dompurify` path resolves a stable
  `>=3.4.11 <4` version.
- The package-anchored contract fails on DOMPurify 3.4.5 for the expected floor
  assertion and passes after the targeted refresh.
- Mermaid remains on 11.15.0 and every package manifest remains unchanged.
- The pre-refresh boundary characterization proves strict initialization,
  successful SVG insertion, render-error handling, and scratch cleanup, and it
  remains green after the dependency refresh.
- Existing chat and artifact Mermaid coverage passes.
- Official-registry audit reports 0 critical, 0 high, 2 moderate, and 1 low,
  or an explained stricter result, with no DOMPurify record.
- Frozen install, clean typecheck, typecheck, lint, all tests, and the workspace
  build pass.
- The lockfile contains no unrelated Babel, deprecation metadata, Testing
  Library, workspace-link, or other package movement.
- Exact remote-head verification is clean and reproducible.
- Native desktop packages validate on Windows, macOS, and Linux with three
  non-empty artifacts and zero annotations.
- Specification and implementation are delivered through separate reviewed
  PRs, each branched from its appropriate current `origin/main`; the spec PR
  is documentation-only and squash-merged before implementation starts.
