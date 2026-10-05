// Builds native/bin/mathocr, the helper that reads math from images with Apple's
// on-device model. Runs after `npm install` and before `npm run build`.
// It needs Xcode or the Command Line Tools with the macOS 27 SDK; without them the
// app still works, it just can't read images. So this never fails the install.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, 'mathocr.swift');
const output = path.join(__dirname, 'bin', 'mathocr');

function skip(message) {
  console.warn(`MacMath: image recognition helper not built. ${message}`);
  process.exit(0);
}

if (process.platform !== 'darwin') skip('It needs macOS.');
// Apple Intelligence only runs on Apple silicon
if (process.arch !== 'arm64') skip('It needs an Apple silicon Mac.');

let sdkVersion;
try {
  sdkVersion = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], { encoding: 'utf8' }).trim();
} catch {
  skip('Install the Xcode Command Line Tools (xcode-select --install), then run npm run build:ocr.');
}
if (parseInt(sdkVersion, 10) < 27) {
  skip(`It needs the macOS 27 SDK (found ${sdkVersion}). Update Xcode or the Command Line Tools, then run npm run build:ocr.`);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
try {
  execFileSync('xcrun', [
    '--sdk', 'macosx', 'swiftc', '-O',
    // Same minimum as Electron; on older systems the helper reports that it needs macOS 27
    '-target', 'arm64-apple-macos13.0',
    // FoundationModels doesn't exist before macOS 26, so it must not be a hard dependency
    '-Xlinker', '-weak_framework', '-Xlinker', 'FoundationModels',
    source, '-o', output
  ], { stdio: 'inherit' });
} catch {
  skip('swiftc failed (see above).');
}
console.log(`MacMath: built ${path.relative(process.cwd(), output)}`);
