# Node 24 GitHub Actions Runtime Design

**Issue:** https://github.com/aiis2/risk-agent/issues/10

## Context

The desktop release workflow runs the project on Node 24, but its bootstrap
steps still use `actions/checkout@v4`, `pnpm/action-setup@v4`,
`actions/setup-node@v4`, and `actions/upload-artifact@v4`. Those action majors
declare the Node 20 action runtime. GitHub currently forces them onto Node 24
and annotates every native release job with a deprecation warning.

The warning is not emitted by Risk Agent application code. It means the
workflow depends on a temporary runner compatibility behavior before the
repository install begins. The release pipeline is now a product gate, so its
bootstrap runtime should be explicit and supported.

As of 2026-07-18, the reviewed stable upstream releases are:

- `actions/checkout@v7.0.0`
- `actions/setup-node@v7.0.0`
- `actions/upload-artifact@v7.0.1`
- `pnpm/action-setup@v6.0.9`

Each release's `action.yml` declares `runs.using: node24`.

## Goals

- Remove the Node 20 action-runtime dependency and its release annotations.
- Keep the project runtime on Node 24 and pnpm on the version declared by the
  repository `packageManager` field.
- Preserve the release matrix, signing isolation, frozen dependency graph,
  packaged runtime validation, and fatal artifact policy.
- Add a focused regression contract for the reviewed action majors.
- Prove the upgrade on all three native GitHub runners before merge.

## Non-Goals

- Changing the application Node or Electron baseline.
- Adding a general pull-request CI workflow.
- Changing artifact names, retention, signing secrets, or release triggers.
- Pinning actions to immutable commit SHAs in this cycle.
- Updating application npm dependencies.

## Options Considered

### 1. Upgrade all four actions to current Node 24-backed majors

This is the selected option. It removes every instance of the warning from the
only repository workflow and keeps the bootstrap stack internally current.
The exact native workflow run validates compatibility rather than assuming
that unchanged YAML inputs imply unchanged behavior.

### 2. Upgrade only to the first Node 24-backed majors

Checkout and setup-node introduced Node 24 support before their current major.
Stopping on those intermediate versions would remove the immediate warning,
but would deliberately retain older action implementations without a project
compatibility requirement. The same native validation cost can cover the
current stable majors.

### 3. Keep v4 and tolerate GitHub's forced runtime

This preserves the warning and relies on compatibility behavior controlled by
the runner platform. It postpones a small reviewed migration until it becomes
an outage and is therefore rejected.

## Detailed Design

### Workflow references

Update only these references in `.github/workflows/release-desktop.yml`:

- `actions/checkout@v4` to `actions/checkout@v7`
- `pnpm/action-setup@v4` to `pnpm/action-setup@v6`
- `actions/setup-node@v4` to `actions/setup-node@v7`
- `actions/upload-artifact@v4` to `actions/upload-artifact@v7`

Major tags follow the repository's existing Dependabot-compatible convention.
The reviewed release versions establish the runtime and migration evidence;
GitHub resolves the maintained major tag to its compatible patch release.

No action inputs change. In particular, setup-node retains `node-version: 24`
and `cache: pnpm`, pnpm setup continues to read `packageManager` rather than
declaring a duplicate version, and artifact upload retains fatal missing-file
handling and 14-day retention.

### Regression contract

Extend the existing desktop release workflow test. It must require each new
major and reject each old major. Assertions remain narrow string contracts;
the workflow is not snapshotted.

### Native validation

Static tests cannot prove action bootstrap compatibility. Dispatch
`release-desktop.yml` on the exact implementation branch and require all three
matrix jobs to complete packaging, runtime SQLite validation, and artifact
upload. Inspect the run annotations and logs to prove the prior Node 20 warning
is absent.

## Error Handling And Rollback

An action bootstrap or input incompatibility fails before packaging. Because
the implementation changes four isolated `uses:` references, it can be
reverted independently without changing application artifacts or data.

The workflow remains manually dispatchable, so a branch-scoped run provides
authoritative evidence before the implementation reaches `main`.

## Acceptance Criteria

- The workflow contains all four reviewed Node 24-backed action majors.
- The workflow contains none of the four legacy action majors.
- Existing release commands, secrets, validation, and artifact settings are
  unchanged.
- Focused and repository checks pass.
- An exact-head native run succeeds for Windows, macOS, and Linux.
- The exact-head run has no Node 20 action-runtime annotation.
- The implementation PR closes issue #10.
