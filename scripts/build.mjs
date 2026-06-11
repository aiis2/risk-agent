#!/usr/bin/env node
/**
 * Unified build entry - builds core -> server -> web in correct order.
 */
import { spawnSync } from 'node:child_process';

const steps = [
  ['pnpm', ['--filter', '@risk-agent/core', 'build']],
  ['pnpm', ['--filter', '@risk-agent/server', 'build']],
  ['pnpm', ['--filter', '@risk-agent/web', 'build']]
];

for (const [cmd, args] of steps) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (res.status !== 0) process.exit(res.status ?? 1);
}
console.log('\n✅ All packages built.');
