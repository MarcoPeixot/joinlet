import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

/** Asks the OS for a free port. 5178 is left to the developer's own dev server. */
function freePort(): string {
  const script = "const s = require('node:net').createServer().listen(0, () => { console.log(s.address().port); s.close(); });";
  return execFileSync(process.execPath, ['-e', script]).toString().trim();
}

// Workers re-evaluate this file; the env var keeps them on the port the main process picked.
process.env.STRUKT_E2E_PORT ??= freePort();
const port = Number(process.env.STRUKT_E2E_PORT);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}`, storageState: { cookies: [], origins: [{ origin: `http://localhost:${port}`, localStorage: [{ name: 'joinlet:locale', value: 'pt-BR' }] }] } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1680, height: 900 } } }],
  webServer: {
    command: `bun run dev --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    // The owner's API only accepts the app's own origin; the e2e Vite runs on a free port, not 5178.
    env: { STRUKT_ALLOWED_ORIGINS: `http://localhost:${port},http://127.0.0.1:${port}` },
    timeout: 60_000,
  },
});
