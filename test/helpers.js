// Shared launch helper for the Playwright specs. Each test launches its own app with an
// isolated profile (MACMATH_USER_DATA) and a fake paste backend (MACMATH_PASTE_LOG).

const { _electron: electron, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// `options.profile` reuses a profile from an earlier launch, to test persistence.
// `options.env` adds environment variables, e.g. MACMATH_FAKE_SELECTION.
async function launchApp(options = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'macmath-test-'));
  const userData = options.profile || path.join(tmp, 'userData');
  const pasteLog = path.join(tmp, 'paste.jsonl');

  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT],
    cwd: ROOT,
    env: { ...process.env, MACMATH_USER_DATA: userData, MACMATH_PASTE_LOG: pasteLog, ...(options.env || {}) }
  });

  // The popover starts hidden; show it so the renderer has keyboard focus.
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const [win] = BrowserWindow.getAllWindows();
    win.show();
    win.focus();
  });
  await page.waitForFunction(() => {
    const mf = document.getElementById('mathfield');
    return Boolean(mf && customElements.get('math-field') && typeof mf.setValue === 'function');
  });

  return { app, page, pasteLog, userData };
}

async function setFormula(page, latex) {
  await page.evaluate((value) => {
    const mf = document.getElementById('mathfield');
    mf.setValue(value);
    mf.focus();
  }, latex);
  await expect.poll(() => editorLatex(page)).toBe(latex);
}

function editorLatex(page) {
  return page.evaluate(() => document.getElementById('mathfield').getValue('latex'));
}

function readClipboard(app) {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

function clearClipboard(app) {
  return app.evaluate(({ clipboard }) => clipboard.writeText(''));
}

function pasteCalls(pasteLog) {
  if (!fs.existsSync(pasteLog)) return [];
  return fs.readFileSync(pasteLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

module.exports = { ROOT, launchApp, setFormula, editorLatex, readClipboard, clearClipboard, pasteCalls };
