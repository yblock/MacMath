// Builds the native helpers in native/bin. Runs after `npm install` and before `npm run build`.
//  - textboxes: finds words in an image (Vision) so italic words can be told from upright ones.
//    Needs Xcode or the Command Line Tools.
//  - mathocr: reads math from images with Apple's on-device model. Needs Apple silicon and the macOS 27 SDK.
// Without them the app still works, with less: so this never fails the install.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const bin = path.join(__dirname, 'bin');

function warn(helper, message) {
  console.warn(`MacMath: ${helper} not built. ${message}`);
}

function swiftc(name, extraArgs) {
  const output = path.join(bin, name);
  fs.mkdirSync(bin, { recursive: true });
  try {
    execFileSync('xcrun', [
      '--sdk', 'macosx', 'swiftc', '-O',
      // Same minimum as Electron
      '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`,
      ...extraArgs,
      path.join(__dirname, `${name}.swift`), '-o', output
    ], { stdio: 'inherit' });
    console.log(`MacMath: built ${path.relative(process.cwd(), output)}`);
  } catch {
    warn(name, 'swiftc failed (see above).');
  }
}

function build() {
  if (process.platform !== 'darwin') return warn('Native helpers', 'They need macOS.');

  let sdkVersion;
  try {
    sdkVersion = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], { encoding: 'utf8' }).trim();
  } catch {
    return warn('Native helpers', 'Install the Xcode Command Line Tools (xcode-select --install), then run npm run build:ocr.');
  }

  swiftc('textboxes', []);

  const helper = 'The Apple Intelligence image helper';
  // Apple Intelligence only runs on Apple silicon
  if (process.arch !== 'arm64') return warn(helper, 'It needs an Apple silicon Mac.');
  if (parseInt(sdkVersion, 10) < 27) {
    return warn(helper, `It needs the macOS 27 SDK (found ${sdkVersion}). Update Xcode or the Command Line Tools, then run npm run build:ocr.`);
  }
  // On older systems mathocr reports that it needs macOS 27. FoundationModels doesn't exist
  // before macOS 26, so it must not be a hard dependency.
  swiftc('mathocr', ['-Xlinker', '-weak_framework', '-Xlinker', 'FoundationModels']);
}

build();
