import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const coreSourceEntry = fileURLToPath(new URL('../core/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@risk-agent\/core$/,
        replacement: coreSourceEntry,
      },
    ],
  },
});
