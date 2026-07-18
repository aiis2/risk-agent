# Clean Workspace Tests Design

## Context

Issue #16 records a reproducible clean-checkout failure on
`origin/main@e76d429`. After `pnpm install --frozen-lockfile`, the core package
has no generated `dist`, so the README-documented `pnpm test` command cannot
collect most server suites. Vite follows `@risk-agent/core` through the
package's production export to `dist/index.js` and reports that the package
entry cannot be resolved.

The failure is state-dependent. A warm worktree with a previous core build
passes, while a fresh checkout fails with 22 failed suites and three failed
tests. Building core before the focused failing suite makes all three tests
pass, which isolates the missing generated entry as the root cause.

## Goals

- Make a frozen install followed directly by the root test command pass.
- Make server tests execute the current core source, not stale build output.
- Keep the production core package exports and server runtime resolution
  unchanged.
- Preserve the existing Vitest workspace and package-level project layout.
- Add a cheap contract check that remains meaningful in warm worktrees.

## Non-goals

- Changing how production server builds or packaged desktop applications load
  core.
- Publishing TypeScript source through core's production exports.
- Building workspace packages as a side effect of the test command.
- Introducing a general alias framework for packages that do not exhibit this
  failure.
- Changing package manifests or the pnpm lockfile.

## Approaches considered

### 1. Server Vitest-only source alias (selected)

Add `packages/server/vitest.config.ts` and use Vite's structured alias form to
map the exact root import `@risk-agent/core` to `packages/core/src/index.ts`.
The alias uses an anchored regular expression so imports such as
`@risk-agent/core/example` are not rewritten accidentally.

This keeps the correction inside the consumer and environment where the
failure occurs. Server tests already transform TypeScript source, so loading
the referenced workspace project's source is consistent with their execution
model. Production package exports and compiled server output remain untouched.

### 2. Build core in the root test script

Changing `test` to build core first would make the command pass, but it would
turn a verification command into a state-mutating build pipeline. It would
also keep server tests coupled to generated output and allow stale `dist`
contents to influence results.

### 3. Add source conditions to core package exports

A development or source export could make Vite find TypeScript directly, but
it would broaden the production package contract solely to accommodate tests.
Conditional resolution would also affect tools beyond Vitest and create a
larger runtime compatibility surface.

## Architecture

The existing root `vitest.workspace.ts` continues to list `packages/server` as
a project directory. Vitest discovers the new package-local config for that
project. The config computes the core source entry from `import.meta.url`, so
it is independent of the checkout path and operating system.

The alias is represented as one object:

```ts
{
  find: /^@risk-agent\/core$/,
  replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
}
```

Only test-time Vite resolution sees this mapping. TypeScript project
references continue to govern builds, and Node/Electron continue to consume
the core package's compiled exports.

## Regression coverage

Add a focused server test that reads the package-local Vitest config and
requires all parts of the boundary:

- the config exists in the server package;
- it uses the structured alias array rather than a broad object prefix;
- the matcher is anchored to the exact root package name;
- the replacement is derived from `../core/src/index.ts` and `import.meta.url`.

This contract test catches accidental alias removal even when a developer has
an old core `dist`. The authoritative behavioral proof is a fresh clone where
the frozen install leaves core `dist` absent and the complete root test suite
passes without any build step.

## Error handling and portability

There is no runtime fallback. If the source entry moves, the explicit config
and its contract test fail, which is preferable to silently reading generated
or stale output. URL-based path construction handles Windows drive paths,
spaces, non-ASCII checkout paths, macOS, and Linux without manual separators.

## Verification

1. Record the focused contract test failing before the config exists.
2. Add the minimal server Vitest config and make the contract test pass.
3. Delete generated TypeScript outputs, confirm core `dist` is absent, and run
   affected server suites.
4. Run typecheck, lint, builds, and the complete workspace test suite.
5. Clone the exact implementation head, perform a frozen install, verify core
   `dist` is absent, and run `pnpm test` directly.
6. Dispatch the native desktop workflow at the exact head to ensure the
   test-only resolution change does not affect release packaging.

## Acceptance criteria

- A fresh frozen install followed directly by `pnpm test` passes all workspace
  tests with no core prebuild.
- Server tests load current core source through an exact test-only alias.
- The new contract test fails if the alias is absent or broadened.
- Package manifests, lockfile, production exports, and runtime imports are
  unchanged.
- Typecheck, lint, builds, full tests, and exact-head native packaging pass.
