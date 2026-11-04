// Settings kept between launches, in userData/settings.json. recognize.js writes its
// image-engine choice to the same file, so every write merges with what is on disk.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const OUTPUT_FORMATS = ['latex', 'mathml'];

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSetting(key, value) {
  const settings = { ...readSettings(), [key]: value };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

// 'latex' (default) or 'mathml': what Insert and Copy produce
function getOutputFormat() {
  const value = readSettings().outputFormat;
  return OUTPUT_FORMATS.includes(value) ? value : 'latex';
}

function setOutputFormat(format) {
  if (!OUTPUT_FORMATS.includes(format)) throw new Error(`Unknown output format: ${format}`);
  writeSetting('outputFormat', format);
  return format;
}

// Whether the first-launch Accessibility prompt has been shown
function wasAccessibilityPrompted() {
  return readSettings().accessibilityPrompted === true;
}

function markAccessibilityPrompted() {
  writeSetting('accessibilityPrompted', true);
}

module.exports = { getOutputFormat, setOutputFormat, OUTPUT_FORMATS, wasAccessibilityPrompted, markAccessibilityPrompted };
