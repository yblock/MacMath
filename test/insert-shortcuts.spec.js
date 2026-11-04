// Shortcut wiring for issue #2 (https://github.com/yblock/MacMath/issues/2):
//
//   ⌘⏎   Insert — paste the expression into the text field the user came from
//   ⌘⇧⏎  Copy   — put the expression on the clipboard only
//   one setting, "output format", that switches both between LaTeX and MathML
//
// Playwright launches the real Electron app and types into the real MathLive field.
// The one step that cannot run in a test, sending ⌘V to another app, sits behind a
// seam in the app: when the MACMATH_PASTE_LOG environment variable names a file, the
// paste backend appends one JSON line {"text": "..."} per insert to that file instead
// of touching other apps. The tests read that file back.
//
// Seams the app provides for these tests:
//   MACMATH_USER_DATA  env  — isolated profile, so real settings are never touched
//   MACMATH_PASTE_LOG  env  — fake paste backend (see above)
//   window.electronAPI.setOutputFormat('latex' | 'mathml') / getOutputFormat()
//
// The system clipboard is used for real (Electron's clipboard module); whatever text
// was on it before the run is put back afterwards.

const { test, expect, _electron: electron } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FORMULA = '\\frac{1}{2}';

let savedClipboard = '';
test.beforeAll(() => {
  savedClipboard = execFileSync('pbpaste', { encoding: 'utf8' });
});
test.afterAll(() => {
  execFileSync('pbcopy', { input: savedClipboard });
});

// Launches one app with its own profile and paste log. `profile` reuses a profile
// from an earlier launch, to test that settings persist.
async function launchApp(profile) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'macmath-test-'));
  const userData = profile || path.join(tmp, 'userData');
  const pasteLog = path.join(tmp, 'paste.jsonl');

  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT],
    cwd: ROOT,
    env: { ...process.env, MACMATH_USER_DATA: userData, MACMATH_PASTE_LOG: pasteLog }
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
  await expect.poll(() => page.evaluate(() => document.getElementById('mathfield').getValue('latex'))).toBe(latex);
}

function readClipboard(app) {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

function pasteCalls(pasteLog) {
  if (!fs.existsSync(pasteLog)) return [];
  return fs.readFileSync(pasteLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function clearClipboard(app) {
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
}

// --- Harness -------------------------------------------------------------------

test('launches with an isolated profile and shows the editor', async () => {
  const { app, page, userData } = await launchApp();
  try {
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(userData);
    await expect(page.locator('#mathfield')).toBeVisible();
    await expect(page.locator('#insertBtn')).toBeVisible();
    await expect(page.locator('#copyBtn')).toBeVisible();
  } finally {
    await app.close();
  }
});

// --- Insert and copy ---------------------------------------------------------------

test('⌘⏎ inserts the LaTeX into the previous app and nothing else', async () => {
  const { app, page, pasteLog } = await launchApp();
  try {
    await clearClipboard(app);
    await setFormula(page, FORMULA);

    await page.keyboard.press('Meta+Enter');

    await expect.poll(() => pasteCalls(pasteLog).length, { message: 'one paste call expected' }).toBe(1);
    expect(pasteCalls(pasteLog)[0].text).toBe(FORMULA);
  } finally {
    await app.close();
  }
});

test('⌘⇧⏎ copies the LaTeX to the clipboard and does not paste', async () => {
  const { app, page, pasteLog } = await launchApp();
  try {
    await clearClipboard(app);
    await setFormula(page, FORMULA);

    await page.keyboard.press('Meta+Shift+Enter');

    await expect.poll(() => readClipboard(app)).toBe(FORMULA);
    expect(pasteCalls(pasteLog)).toEqual([]);
  } finally {
    await app.close();
  }
});

// --- Output format setting -----------------------------------------------------------

test('defaults to LaTeX output', async () => {
  const { app, page } = await launchApp();
  try {
    expect(await page.evaluate(() => window.electronAPI.getOutputFormat())).toBe('latex');
  } finally {
    await app.close();
  }
});

test('with MathML selected, ⌘⏎ inserts MathML and ⌘⇧⏎ copies MathML', async () => {
  const { app, page, pasteLog } = await launchApp();
  try {
    await clearClipboard(app);
    // The toggle in the window is the user's path; the setting API is checked separately
    await page.locator('.format-toggle button[data-format="mathml"]').click();
    await expect.poll(() => page.evaluate(() => window.electronAPI.getOutputFormat())).toBe('mathml');
    // Exactly one format button is pressed, and the MathML-for Web/Word toggle is untouched
    await expect(page.locator('.format-toggle button[data-format="mathml"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.format-toggle button[data-format="latex"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.target-toggle button[data-target="web"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.target-toggle button[data-target="word"]')).toHaveAttribute('aria-pressed', 'false');
    await setFormula(page, FORMULA);

    await page.keyboard.press('Meta+Enter');
    await expect.poll(() => pasteCalls(pasteLog).length).toBe(1);
    const inserted = pasteCalls(pasteLog)[0].text;
    expect(inserted).toMatch(/^<math[\s>]/);
    expect(inserted).toContain('<mfrac>');

    await page.keyboard.press('Meta+Shift+Enter');
    await expect.poll(() => readClipboard(app)).toMatch(/^<math[\s>]/);
    expect(await readClipboard(app)).toContain('<mfrac>');
    expect(pasteCalls(pasteLog)).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test('the output format survives a relaunch', async () => {
  const first = await launchApp();
  await first.page.evaluate(() => window.electronAPI.setOutputFormat('mathml'));
  await first.app.close();

  const second = await launchApp(first.userData);
  try {
    expect(await second.page.evaluate(() => window.electronAPI.getOutputFormat())).toBe('mathml');
  } finally {
    await second.app.close();
  }
});
