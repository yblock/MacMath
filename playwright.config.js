// Playwright drives the Electron app directly (no browser download needed).
// Run with `npm test`. Tests launch one app instance each, so they run serially.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.js',
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results'
});
