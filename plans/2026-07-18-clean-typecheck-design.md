# Clean Typecheck Dependency Boundary Design

**Issue:** https://github.com/aiis2/risk-agent/issues/13

## Context

The README lists `pnpm typecheck` as a common command. On a clean checkout,
however, `pnpm install --frozen-lockfile` followed directly by that command
fails in the desktop project with three `TS2307` errors for
`@risk-agent/server`.

Desktop declares the server workspace dependency as injected. pnpm snapshots
that package during install so electron-builder receives a concrete production
tree rather than an unreliable workspace symlink. At clean-install time the
server has no generated `dist`, and its package manifest exposes only
`main: ./dist/index.js`. Desktop currently imports the server package for
Browser Host interface types and uses a server package type query to describe
the dynamically loaded `buildApp` function. TypeScript therefore cannot resolve
desktop until server output exists and pnpm refreshes the injected snapshot.

The release workflow legitimately performs that build-and-refresh sequence for
packaging. A repository typecheck should not require it: typechecking is
expected to be a direct, read-only quality gate after installation.

## Goals

- Make clean frozen install followed directly by root typecheck succeed.
- Remove desktop's compile-time dependency on generated server output.
- Give Browser Host adapter contracts one shared source of truth.
- Preserve the runtime dynamic import of the packaged server.
- Preserve injected production packaging and its validated native artifacts.
- Add a narrow regression contract for the dependency boundary.

## Non-Goals

- Removing the injected server dependency from desktop packaging.
- Combining server and desktop packages.
- Changing Browser Host behavior or the Fastify runtime.
- Changing the release workflow's production refresh sequence.
- Checking generated server declarations into source control.

## Options Considered

### 1. Move shared Browser Host contracts to core

This is the selected option. Core already owns cross-package protocols and is a
TypeScript project dependency built before server and desktop. The server can
re-export the contract from its existing local module, preserving internal and
external type import paths. Desktop resolves the type-only contract through a
TypeScript path alias and project reference, without adding a production npm
edge. Desktop can describe only the subset of the dynamically loaded server
module it calls, avoiding a package type query.

This makes the source dependency graph match the architecture: desktop and
server both depend on shared contracts, while only desktop's runtime loader
depends on the packaged server implementation.

### 2. Make typecheck build and reinstall dependencies first

A wrapper could build core/server, run an offline frozen install, then invoke
`tsc -b`. This works mechanically but turns a typecheck into a stateful build
and dependency mutation, slows every invocation, and hides the inverted type
boundary. It is retained only for production staging where concrete files are
required.

### 3. Point server `types` at `src/index.ts`

An isolated clean-install experiment showed this does not work. Desktop uses
CommonJS compiler settings; following the server's ESM TypeScript source made
desktop compilation process server files containing `import.meta`, producing
five `TS1343` errors. It also exposes implementation source as a package type
surface rather than a stable shared contract.

### 4. Commit generated server declarations

Checking `dist/*.d.ts` into Git would give the injected snapshot a resolvable
entrypoint but introduces generated-file drift and duplicates the build output
contract. It is rejected.

## Detailed Design

### Shared contract ownership

Move the interfaces currently defined in
`packages/server/src/browser/BrowserHostAdapter.ts` into
`packages/core/src/browser/BrowserHostAdapter.ts` and export them from core's
public index.

Keep the server module path as a type-only re-export from `@risk-agent/core`.
Existing server imports and consumers therefore keep working while the
definition has one owner.

### Desktop compile-time boundary

Add a desktop TypeScript project reference to core and map the type-only
`@risk-agent/core/browser-host` alias directly to the pure contract source.
Change desktop Browser Host imports to that alias. Do not add a desktop npm
dependency on core: pnpm deduplicates that direct link into the injected server
snapshot, changing the production core edge from a concrete `file:` package to
a workspace `link:` and weakening the release graph repaired in issue #7.

In `backend.ts`, replace `Parameters<typeof import('@risk-agent/server')...>`
with a local structural interface containing only the `buildApp` input and
result members that desktop calls. The runtime loader remains the existing
indirect dynamic import of the string `@risk-agent/server`; no server code is
bundled into desktop and the production dependency remains declared.

The package manifest and lockfile remain unchanged. The TypeScript reference is
the compile-time edge; the existing server dependency remains the production
runtime edge.

### Regression coverage

Add a focused desktop dependency-boundary test that reads source and
configuration as structured text or JSON. It requires:

- a core project reference and type-only path alias, with no new production
  core dependency;
- desktop Browser Host types to import from core;
- no static import or TypeScript type query for `@risk-agent/server`;
- the runtime server specifier to remain present;
- server's compatibility re-export to point at core.

The authoritative integration gate is a new clean worktree: frozen install,
then root typecheck with no build or refresh between them.

### Release compatibility

The production stage still installs both core and server, and the server remains
a desktop runtime dependency. Dispatch the native release workflow on the exact
implementation head because the desktop manifest and lockfile change. Require
all platform runtime probes and artifact uploads before merge.

## Error Handling And Rollback

Type-only contract movement has no data or runtime migration. A missing export
or dependency edge fails TypeScript and focused tests. A packaging regression
fails the branch-scoped native workflow before merge.

The change can be reverted independently, restoring the prior generated-output
coupling while leaving stored application data untouched.

## Acceptance Criteria

- Clean frozen install followed directly by root typecheck exits zero.
- Desktop has no compile-time import or type query for the server package.
- Desktop retains the runtime server dynamic import and production dependency.
- Browser Host adapter contracts are defined once in core and remain available
  through the server compatibility module.
- Focused tests, lint, typecheck, and the full test suite pass.
- Exact-head native Windows, macOS, and Linux packages pass runtime validation.
- The implementation PR closes issue #13.
