#!/usr/bin/env node
/**
 * Dev entry - runs server + web + Playwright MCP server concurrently.
 *
 * Playwright MCP server runs on port 8931 (http transport) to provide
 * browser automation tools (browser_navigate, browser_click, etc.) to the agent.
 * The MCP server entry is pre-configured in the DB as "playwright" at http://localhost:8931/mcp.
 */
import { spawn } from 'node:child_process';

const children = [
  spawn('pnpm', ['--filter', '@risk-agent/server', 'dev'], { stdio: 'inherit', shell: true }),
  spawn('pnpm', ['--filter', '@risk-agent/web', 'dev'], { stdio: 'inherit', shell: true }),
  spawn('node', ['node_modules/@playwright/mcp/cli.js', '--port', '8931', '--headless'], {
    stdio: 'inherit',
    shell: false,
  }),
];

const shutdown = () => {
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch {}
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
