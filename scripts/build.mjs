#!/usr/bin/env node
/**
 * Unified build entry - builds core -> server -> web in correct order.
 */
import { spawnSync } from 'node:child_process';

const steps = [
  ['--filter', '@risk-agent/core', 'build'],
  ['--filter', '@risk-agent/server', 'build'],
  ['--filter', '@risk-agent/web', 'build']
];

const packageManagerCli = process.env.npm_execpath;
if (!packageManagerCli) {
  console.error('[ERROR] Run the workspace build through pnpm: `pnpm build`.');
  process.exit(1);
}

for (const args of steps) {
  console.log(`\n> pnpm ${args.join(' ')}`);
  const res = spawnSync(process.execPath, [packageManagerCli, ...args], { stdio: 'inherit' });
  if (res.error) {
    console.error(`[ERROR] Failed to start pnpm: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) process.exit(res.status ?? 1);
}
console.log('\n✅ All packages built.');
