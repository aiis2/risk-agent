# Fastify Runtime Dependency Security Design

## Context

Issue #28 records the production dependency audit baseline on
`origin/main@9e2181ec35c7bc971aaa2e6889d9d95a8590d2f6`. A frozen install
passes clean typecheck, typecheck, lint, 102 test files / 524 tests, and the
workspace build, but an official-registry production audit reports 5 high,
8 moderate, and 5 low findings.

The remaining high findings are in two server runtime families:

- `fastify@4.29.1` is inside the published affected ranges. The applicable
  fixes require Fastify 5.8.3 or newer, and no patched Fastify 4 release line
  exists.
- The server graph resolves `fast-uri@2.4.0` and `fast-uri@3.1.0`. The two
  high-severity fast-uri advisories require 3.1.2 or newer.

A disposable migration trial selected Fastify 5.10.0,
`@fastify/cors@11.3.0`, `@fastify/websocket@11.3.0`, and fast-uri 3.1.4 or
4.1.1. The structured audit then reported 0 high, 7 moderate, and 4 low
findings, with no Fastify, plugin, or fast-uri advisories. The trial passed
the repository gates above and the production build.

The local malformed Content-Type probe did not reproduce the Fastify
advisory: `Content-Type: application/json<TAB>a` returned
`415 FST_ERR_CTP_INVALID_MEDIA_TYPE` on Fastify 4. The security case therefore
uses the official advisory ranges and upstream strict parser fix rather than
claiming a reproduced exploit.

## Goals

- Move the server to a patched Fastify 5 release and compatible plugin majors.
- Resolve every server-owned fast-uri path at or above 3.1.2.
- Remove every Fastify, Fastify-plugin, and fast-uri record from the official
  npm production audit.
- Add deterministic, network-free contracts for both declared major lines and
  the actual installed graph under pnpm's strict layout.
- Preserve a real websocket event round trip across the plugin major upgrade.
- Preserve release packaging semantics and exclude unrelated lockfile churn.

## Non-goals

- Fixing DOMPurify, React Router, js-yaml, esbuild, or other independent
  moderate/low advisory families in this cycle.
- Refreshing the complete workspace dependency graph.
- Changing server routes, request schemas, registry configuration, scripts,
  workflows, or supported Node versions.
- Changing the web Axios defaults without a demonstrated failure in a
  supported runtime.
- Claiming that the local malformed Content-Type probe reproduced the
  advisory.

## Approaches considered

### 1. Coordinated Fastify 5 migration and targeted fast-uri refresh (selected)

Move Fastify and both directly owned plugins to their compatible major lines,
then refresh fast-uri through the affected server-owned dependency paths.
Protect the result with manifest and installed-version contracts.

This is the only bounded approach that removes all five remaining high
findings. Node 24 already exceeds Fastify 5's Node 20 minimum.

### 2. Keep Fastify 4 and patch only fast-uri

This would remove the fast-uri records but retain Fastify on an affected major
with no patched v4 release. It does not meet the high-severity acceptance
gate.

### 3. Run a broad recursive update or use a global override

A broad update moves unrelated Babel, testing, UI, desktop, and workspace
packages. A global fast-uri override would conceal ownership and could force
an incompatible major into unrelated parents. Neither is required for the
verified trial graph.

## Dependency contract

The direct server manifest contract is:

```text
fastify             declared 5.x, installed >=5.8.3 <6
@fastify/cors       declared 11.x, installed >=11.0.0 <12
@fastify/websocket  declared 11.x, installed >=11.0.0 <12
```

The expected trial resolutions are 5.10.0, 11.3.0, and 11.3.0. The floors
and major ceilings, rather than those exact patch versions, define runtime
compatibility. The implementation also verifies that each declaration is a
caret range on the required major so a compatible future frozen graph cannot
silently return to Fastify 4 or plugin 9/10.

The fast-uri contract follows every current server-owned production path
reported by `pnpm why fast-uri --prod --depth 20`:

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

Every resolved fast-uri manifest must be a stable semantic version at or
above 3.1.2. The trial resolves 3.1.4 through AJV/compiler paths and 4.1.1
through `fast-json-stringify@7.0.1`. The structured production audit remains
the backstop for any new fast-uri path introduced by future dependency graph
changes.

## Regression test

Extend `packages/server/src/__tests__/runtimeDependencySecurity.spec.ts`.
Reuse its manifest reader, stable semantic-version parser, numeric comparator,
and `createRequire` anchors rather than parsing `pnpm-lock.yaml` as text.

Add a direct-package table that asserts each manifest range has the required
caret-major and that the package resolved from the server manifest is within
its installed floor and ceiling.

Add a package-metadata resolver that first resolves the structured
`<package>/package.json` subpath and walks upward from that path until it finds
a manifest with the requested `name`. If a package does not export that
subpath, resolve its entry point and perform the same named upward walk.
Metadata-first resolution is required because the SDK wildcard maps
`@modelcontextprotocol/sdk/package.json` to a nameless
`dist/cjs/package.json`, while its default CommonJS entry targets a missing
`dist/cjs/index.js`; walking upward from the metadata subpath reaches the real
root manifest without touching the broken entry.

Build the chain resolver on that metadata helper. Start at the server
manifest, resolve each named package in order, and re-anchor `createRequire`
at each resolved manifest. Exercise all eleven audited chains above and assert
the 3.1.2 floor at every terminal fast-uri manifest.

On the merged specification base, the new direct cases must fail for Fastify
4.29.1, CORS 9.0.1, and WebSocket 10.0.1. The fast-uri chain cases must fail
for the vulnerable 2.4.0 or 3.1.0 copies. Existing Hono and ws cases remain
green.

## WebSocket compatibility contract

The repository has no automated websocket coverage even though
`@fastify/websocket` crosses from major 10 to 11. Add
`packages/server/src/__tests__/websocket.spec.ts` as a real application
characterization test before changing dependencies.

Create a temporary data directory, build the complete app, await readiness,
and open `/api/ws/storage` through the plugin's `app.injectWS` interface.
Publish `storage-validation-finished` through the real `storageEventBus` and
assert that the socket receives the decoded event type and data. Terminate the
socket, await its close event, and assert that the event bus listener count
returns to the pre-connection baseline. Close the app and remove the temporary
directory in `finally`.

This test is expected to pass on the Fastify 4/plugin 10 baseline; it records
existing supported behavior rather than introducing new production behavior.
Run it again after the migration to prove that plugin 11 preserves the route
registration, direct `(socket, request)` handler contract, event delivery, and
listener cleanup.

## Manifest and lockfile update

Generate the candidate graph with the directly owned migration followed by a
targeted depth-aware fast-uri refresh:

```powershell
corepack pnpm --filter @risk-agent/server update fastify@^5.10.0 @fastify/cors@^11.3.0 @fastify/websocket@^11.3.0
corepack pnpm update fast-uri --recursive --depth 100 --lockfile-only
```

Retain the three server manifest ranges, the Fastify 5 closure, and the
fast-uri 3.1.4/4.1.1 paths required by that graph. The Fastify closure includes
compatible compiler, router, serializer, logger, and injection packages, so
those transitive replacements are expected.

Exclude generated Babel patch additions, testing-library reference changes,
and workspace `file:` to `link:` normalization. In particular, preserve the
`@risk-agent/core@file:packages/core` package/snapshot and the injected server
snapshot's `file:packages/core` reference because desktop packaging relies on
the injected workspace graph.

## Audit verification

Run the network security gate explicitly against the official registry:

```powershell
corepack pnpm audit --prod --json --registry=https://registry.npmjs.org
```

The configured mirror does not expose an audit endpoint, so an endpoint error
is a verification failure rather than a clean result. Parse the JSON despite
the command's non-zero exit for independent findings. Require zero critical,
zero high, zero scoped Fastify/plugin/fast-uri records, and the reproduced
totals of 7 moderate and 4 low unless the live registry adds a documented
independent advisory while the PR is open.

## Fastify 5 compatibility and failure handling

Fastify 5 rejects an explicitly advertised JSON request with no body. Axios
1.16's shipped browser XHR adapter removes Content-Type when request data is
undefined, and an actual XHR-to-Fastify probe completed without that header.
Node and fetch adapters retained the configured header, but neither is the
supported Vite/Electron renderer transport. Do not add speculative client
code in this migration unless exact supported-runtime verification exposes a
real failure; if it does, reproduce it with a failing test before changing
the client.

If Fastify 5 changes a route, websocket, CORS, or serialization behavior,
first reproduce the supported application failure and make the smallest
compatibility fix under TDD. If the fix expands beyond a bounded migration,
stop and split it into a separate issue rather than weakening the security
contract.

If generated lockfile churn cannot be separated from the required graph, do
not hide it with an override. Regenerate from a clean specification base and
compare each retained node with the trial.

## Verification

1. Add the websocket characterization and record its GREEN baseline behavior.
2. Record RED from the new direct and fast-uri dependency cases on the merged
   specification base.
3. Apply the coordinated manifest and lockfile migration, remove unrelated
   churn, recreate a frozen install, and record dependency GREEN plus the
   websocket post-migration pass.
4. Run clean typecheck, typecheck, lint, all tests, workspace build, diff
   checks, and a subsequent offline frozen install.
5. Parse the official-registry audit and compare it with the 5/8/5 baseline.
6. Verify no unrelated application, dependency, script, workflow, or
   packaging movement entered the diff.
7. Clone the exact pushed implementation head and repeat frozen install,
   focused/full tests, build, structured audit, and clean-status checks.
8. Run Windows, macOS, and Linux native desktop packaging at that exact head;
   require three non-empty artifacts and zero annotations.

## Acceptance criteria

- Frozen installs satisfy the direct manifest and installed-version contract.
- Every scoped installed fast-uri copy is at or above 3.1.2.
- The new contract cases fail on the current graph for the expected version
  assertions and pass after the migration.
- The real `/api/ws/storage` event round trip passes before and after the
  `@fastify/websocket` major migration.
- Official-registry audit reports 0 high, 7 moderate, and 4 low findings, or
  an explained stricter result, with no scoped Fastify/plugin/fast-uri record.
- Existing 102 test files / 524 tests plus the new cases pass with frozen
  install, clean typecheck, typecheck, lint, and workspace build.
- Native desktop packages validate on Windows, macOS, and Linux.
- No unrelated Babel, workspace-link, source, registry, script, workflow, or
  dependency movement is included.
