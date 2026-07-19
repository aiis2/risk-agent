# Runtime Transport Dependency Security Design

## Context

Issue #25 records the production dependency audit baseline on
`origin/main@279a0da32c140c59f166c102506a4ee89f4d545f`. A frozen install
passes the current repository baseline of 101 test files and 522 tests, but an
official-registry production audit reports 7 high, 17 moderate, and 5 low
findings.

Two transitive packages on real server request paths account for 2 high and 9
moderate findings:

- `@modelcontextprotocol/sdk@1.29.0` accepts Hono 4.x and currently resolves
  `hono@4.12.19`. The listed fixes require Hono 4.12.25.
- `@fastify/websocket@10.0.1` accepts ws 8.x and currently resolves
  `ws@8.20.0`. The listed fixes require ws 8.21.0.

A clean depth-aware lockfile trial selected `hono@4.12.31` and `ws@8.21.1`.
The structured audit then reported 5 high, 8 moderate, and 5 low findings,
with no Hono or ws advisories. pnpm also generated unrelated Babel and
workspace-link churn; those changes are not required and must be excluded.

## Goals

- Resolve Hono at or above 4.12.25 while remaining on Hono 4.x.
- Resolve ws at or above 8.21.0 while remaining on ws 8.x.
- Remove every Hono and ws advisory from the official npm production audit.
- Add a deterministic, network-free contract for the actual installed
  transitive versions under pnpm's strict layout.
- Keep the change limited to the two lockfile resolutions, the regression
  test, and this cycle's documentation.

## Non-goals

- Migrating Fastify 4 or its plugins to their next major versions.
- Adding Hono, ws, or global overrides as new direct dependency policy.
- Refreshing every transitive dependency inside its current range.
- Fixing DOMPurify, esbuild, fast-uri, js-yaml, React Router, or other
  independent advisory families in this cycle.
- Changing application behavior, package manifests, registry configuration,
  scripts, or workflows.

## Approaches considered

### 1. Target the existing compatible transitive ranges (selected)

Use pnpm's depth-aware update for Hono and ws only. Both owning dependencies
already accept the patched versions, so no manifest or application change is
needed. Inspect the generated lockfile and retain only Hono, ws, and the
parent snapshot references that must change with those resolutions.

This removes eleven findings with the smallest runtime and review surface.

### 2. Upgrade Fastify and its plugins now

Fastify 5 can remove a separate Fastify and fast-uri advisory family, but it
requires coordinated plugin major upgrades and server behavior validation.
Combining that migration with compatible Hono/ws patches would enlarge the
rollback boundary and make failures harder to attribute.

### 3. Run a broad recursive update or add overrides

A broad update moves unrelated UI, build, desktop, and server packages.
Global overrides would make the root policy own packages that are currently
well-owned by compatible upstream ranges. Both approaches add scope without
improving the Hono/ws acceptance criteria.

## Dependency contract

`packages/server` directly owns both parent graphs:

```text
@modelcontextprotocol/sdk@1.29.0 -> hono@4.12.19
@fastify/websocket@10.0.1       -> ws@8.20.0
```

The implementation keeps those manifests unchanged and updates only the
transitive resolutions. The installed contract is:

```text
4.12.25 <= hono < 5.0.0
8.21.0  <= ws   < 9.0.0
```

The expected compatible trial resolutions are Hono 4.12.31 and ws 8.21.1.
The floors, rather than those exact patch versions, define the security
contract.

## Regression test

Add `packages/server/src/__tests__/runtimeDependencySecurity.spec.ts`. Resolve
the server manifest from `import.meta.url` and create a `require` anchored at
that manifest. For each child package, resolve the owning parent's exported
package metadata, create another anchored `require`, and resolve the child's
real entry point.

Hono intentionally does not export `hono/package.json`. Starting at the
resolved entry point, walk upward until a JSON package manifest whose `name`
matches the child package is found. Parse its stable semantic version and
compare numeric components with the floor and major ceiling. This follows the
actual pnpm graph without relying on root hoisting or parsing YAML as text.

The two table cases must both fail on the current frozen install: Hono 4.12.19
is below 4.12.25 and ws 8.20.0 is below 8.21.0.

## Lockfile update and audit

Generate the candidate graph with a targeted depth-aware command:

```powershell
corepack pnpm update hono ws --recursive --depth 100 --lockfile-only
```

The final diff may retain only:

- Hono package and snapshot resolution changes;
- ws package and snapshot resolution changes;
- `@hono/node-server`, `@modelcontextprotocol/sdk`, and
  `@fastify/websocket` snapshot references to those versions.

Exclude generated Babel patch additions, `file:` to `link:` workspace
normalization, and every unrelated package movement.

Run the network security gate explicitly against the official registry:

```powershell
corepack pnpm audit --prod --json --registry=https://registry.npmjs.org
```

Parse the JSON even though independent findings keep the command non-zero.
Require Hono and ws scoped counts of zero and the reproduced trial counts of
5 high, 8 moderate, and 5 low unless the live registry adds a new independent
advisory while the PR is open.

## Failure handling

If the targeted update changes a manifest or unrelated lock graph, remove
that churn before proceeding. If either patched package breaks typecheck,
tests, builds, or native packaging, address only compatibility caused by that
package or split the packages into separate issues; do not weaken the test or
use an override to hide the failure.

An audit endpoint failure is a verification failure, not a clean audit. If
the registry baseline changes, record the new advisory identifiers and prove
that Hono and ws remain at zero.

## Verification

1. Record RED from both dependency contract cases on the current frozen graph.
2. Apply the targeted lockfile update, remove unrelated churn, and record
   GREEN.
3. Run frozen install, clean typecheck, lint, all tests, and workspace build.
4. Parse the official-registry audit and compare it with the 7/17/5 baseline.
5. Verify all manifests, application source, scripts, and workflows are
   unchanged.
6. Clone the pushed implementation head and repeat frozen install, focused
   contract, full tests, build, structured audit, and clean-status checks.
7. Run Windows, macOS, and Linux native desktop packaging at that exact head;
   require non-empty artifacts and zero annotations.

## Acceptance criteria

- Frozen installs resolve Hono at `>=4.12.25 <5` and ws at `>=8.21.0 <9`.
- Both contract cases fail on the current graph and pass after the update.
- Official-registry audit reports no Hono or ws advisories and reproduces
  5 high, 8 moderate, and 5 low findings or an explained stricter result.
- Existing 101 test files / 522 tests plus the two new cases pass with
  typecheck, lint, and workspace build.
- Native desktop packages validate on Windows, macOS, and Linux.
- No manifest, application source, registry, script, workflow, or unrelated
  lock graph changes.
