// Copy non-ts assets (schema.sql) into dist/ after tsc build.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = [
  ['src/storage/embedded/sqlite/schema.sql', 'dist/storage/embedded/sqlite/schema.sql']
];

for (const [from, to] of assets) {
  const src = resolve(root, from);
  const dest = resolve(root, to);
  if (!existsSync(src)) continue;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`[copy-assets] ${from} -> ${to}`);
}
