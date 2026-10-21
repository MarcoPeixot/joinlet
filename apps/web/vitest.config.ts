import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/testLocale.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    // Node 25's built-in Web Storage warns on first `globalThis.localStorage` access without
    // a --localstorage-file; disable it so importing state/appStore.ts and ui/uiStore.ts stays quiet.
    execArgv: ['--no-experimental-webstorage'],
  },
});
