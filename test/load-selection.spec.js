// ⌘⇧M with text selected in another app loads that text into the editor
// (issue #2, second half). One end-to-end test for the wiring; the decisions behind
// it are unit-tested in test/unit/selection.test.js.
//
// Seams the app provides for this test:
//   MACMATH_FAKE_SELECTION  env — what readSelection() returns instead of asking
//                                 node-get-selected-text (see selection.js)
//   global.macmathTest      — present when MACMATH_USER_DATA is set, in the main process:
//       openFromShortcut()  the ⌘⇧M handler: reads the selection, then toggles the popover
//       openFromTray()      the menu-bar-click handler: toggles the popover, no selection read

const { test, expect } = require('@playwright/test');
const { launchApp, setFormula, editorLatex } = require('./helpers');

const SELECTED = '\\frac{a}{b}';

test('the shortcut loads the selection into the editor; the tray icon does not', async () => {
  const { app, page } = await launchApp({ env: { MACMATH_FAKE_SELECTION: SELECTED } });
  try {
    // Something is already in the editor, as it usually is
    await setFormula(page, 'x^2');

    const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());

    // Start hidden, as when the user is typing in another app
    await app.evaluate(() => global.macmathTest.openFromTray());
    await expect.poll(visible).toBe(false);

    // The shortcut path: reads the selection, opens, and the selection replaces x^2
    await app.evaluate(() => global.macmathTest.openFromShortcut());
    await expect.poll(visible).toBe(true);
    await expect.poll(() => editorLatex(page)).toBe(SELECTED);

    // The tray path: hide, then show again; the editor is left alone even though a
    // selection is still available
    await setFormula(page, 'y^3');
    await app.evaluate(() => global.macmathTest.openFromTray());
    await expect.poll(visible).toBe(false);
    await app.evaluate(() => global.macmathTest.openFromTray());
    await expect.poll(visible).toBe(true);
    expect(await editorLatex(page)).toBe('y^3');

    // And the shortcut while showing just hides, without touching the editor
    await app.evaluate(() => global.macmathTest.openFromShortcut());
    await expect.poll(visible).toBe(false);
    expect(await editorLatex(page)).toBe('y^3');
  } finally {
    await app.close();
  }
});
