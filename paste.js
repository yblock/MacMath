// Inserting an expression into the app the user came from (issue #2).
//
// The popover is a menu bar utility, so the text field the user was typing in belongs
// to another app. The only way to reach it from here is the clipboard plus a ⌘V sent
// to that app once it is active again, which macOS allows only with Accessibility
// permission for MacMath.
//
// Tests cannot send keystrokes to other apps. When MACMATH_PASTE_LOG names a file, the
// text is appended there as one JSON line per insert and nothing else happens.

const { app, clipboard } = require('electron');
const fs = require('fs');
const { execFile } = require('child_process');

const isMac = process.platform === 'darwin';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sends ⌘V to the frontmost app. Rejects when macOS refuses (no Accessibility permission).
function sendPasteKeystroke() {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'],
      { timeout: 5000 }, (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr || error.message).trim()));
        else resolve();
      });
  });
}

function needsAccessibility(message) {
  // "osascript is not allowed assistive access" / "Not authorized to send Apple events" (-1743, 1002)
  return /assistive|not authorized|1002|-1743|-25211/i.test(message);
}

// Puts `text` on the clipboard, hides the popover so the previous app becomes active,
// and pastes. `hide` is the caller's function that hides the popover and deactivates
// the app. Resolves with { ok: true }, or { ok: false, reason, needsAccessibility } when
// the keystroke could not be sent; the text is on the clipboard either way.
async function insertIntoPreviousApp(text, hide) {
  const log = process.env.MACMATH_PASTE_LOG;
  if (log) {
    fs.appendFileSync(log, JSON.stringify({ text }) + '\n');
    return { ok: true, fake: true };
  }

  const previous = clipboard.readText();
  clipboard.writeText(text);
  hide();

  if (!isMac) return { ok: false, reason: 'Pasting into other apps is only implemented on macOS' };

  // Give macOS a moment to activate the previous app before the keystroke arrives
  await delay(150);
  try {
    await sendPasteKeystroke();
  } catch (error) {
    return { ok: false, reason: error.message, needsAccessibility: needsAccessibility(error.message) };
  }

  // Put the user's own clipboard text back once the paste has been read. Only text is
  // restored: an image or file that was on the clipboard is gone, like after any copy.
  if (previous && previous !== text) {
    setTimeout(() => {
      if (clipboard.readText() === text) clipboard.writeText(previous);
    }, 600);
  }
  return { ok: true };
}

module.exports = { insertIntoPreviousApp };
