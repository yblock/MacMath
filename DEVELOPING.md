# Developing MacMath

Everything about building, changing, testing and releasing MacMath. If you only want to use it, the [README](README.md) is enough.

## Requirements

- A Mac running macOS 13 (Ventura) or later, Apple silicon or Intel
- [Node.js](https://nodejs.org/) 22.12 or newer (the LTS download from nodejs.org works)
- Xcode or the Command Line Tools (`xcode-select --install`): the native helpers are Swift
- Git, or a ZIP of the repository

## Getting the code

```sh
git clone https://github.com/yblock/MacMath.git
cd MacMath
npm install
```

If you downloaded a ZIP instead, extract it, move the `MacMath` folder somewhere easy to find, and `cd` into it in Terminal (type `cd `, drag the folder into the Terminal window, press Return). Keep it out of Desktop and Documents if iCloud Drive syncs those; see [Troubleshooting](#troubleshooting).

`npm install` also compiles the native helpers in `native/`:

- `textboxes` and `mathocr` for reading math from images. `mathocr` needs Apple silicon and the macOS 27 SDK; without them `npm install` prints a warning and the Apple Intelligence option is simply unavailable.
- `sendpaste`, which posts the ⌘V behind Insert.

Rebuild them later with `npm run build:ocr`.

## Running from source

```sh
npm start
```

The first run downloads Electron (about 100 MB). The icon appears in the menu bar; quit with **Quit MacMath** in its right-click menu or `Control + C` in Terminal. After pulling changes, run `npm install` again before starting: dependencies change between versions.

Running from source is unsigned, so macOS forgets the Accessibility permission on every change. For anything involving Insert or loading a selection, build the signed app instead.

## Signing

Every build is signed with a self-signed certificate named "MacMath Dev" in your login keychain. Create it once:

```sh
npm run setup:signing
```

It asks for your macOS login password so that codesign can use the key without prompting on every build; press Return to skip that and click "Always Allow" the first time macOS asks instead. The same identity can be made by hand in Keychain Access: Certificate Assistant → Create a Certificate, name "MacMath Dev", Self Signed Root, Code Signing.

Why: macOS ties the Accessibility permission, which Insert and loading a selection need, to the app's code signature. An ad-hoc signature keys on the content hash and changes with every build, so each rebuild would be a stranger to macOS and lose the permission. One certificate keeps the identity "com.macmath.app signed by MacMath Dev" stable across builds. This is for development; distributing to other people would still need a Developer ID certificate and notarization.

`npm run build` and `npm run build:dir` refuse to run until the identity exists. If MacMath was granted the permission as an ad-hoc build earlier, remove it from System Settings → Privacy & Security → Accessibility and add it again once after the first signed build.

## Building and installing

```sh
npm run build:dir   # signed app bundle in dist/mac-arm64 (dist/mac on Intel)
npm run build       # the same, plus dist/MacMath-<version>-<arch>.dmg
```

Both run `scripts/build-mac.sh`: electron-builder packages the app, codesign signs it with the identity, and the DMG is made with `hdiutil` from the signed bundle (electron-builder's own DMG step would package the unsigned bundle, and hangs on recent macOS). To install, open the `.dmg` and drag MacMath into Applications, or copy `dist/mac-arm64/MacMath.app` there. Replace the old copy; the permission survives because the identity is the same.

## Tests

```sh
npm test            # both suites
npm run test:unit   # node:test, no Electron: the decisions in selection.js
npm run test:e2e    # Playwright drives the real Electron app
```

The Playwright suite in `test/*.spec.js` launches the app with its own profile and types into the real MathLive field. Three environment variables are seams for it:

- `MACMATH_USER_DATA`: a separate settings and history directory, so tests never touch your real ones. It also exposes `global.macmathTest` in the main process with the shortcut and tray handlers, since tests cannot press a global shortcut.
- `MACMATH_PASTE_LOG`: Insert appends `{"text": ...}` lines to this file instead of pasting into another app.
- `MACMATH_FAKE_SELECTION`: stands in for the selection library when ⌘⇧M reads the front app's selection.

What no test covers: the real paste keystroke and the real selection read, which need the Accessibility permission and another app. Check those by hand in Notes after changing `paste.js`, `selection.js` or `native/sendpaste.swift`.

## Commands

| Command | What it does |
|---|---|
| `npm install` | installs packages and compiles the native helpers |
| `npm start` | runs the app from source, unsigned |
| `npm run setup:signing` | creates the signing identity, once per Mac |
| `npm run build:dir` | signed `.app` in `dist/` |
| `npm run build` | signed `.app` and `.dmg` |
| `npm run build:ocr` | recompiles the native helpers |
| `npm test` | unit and Playwright suites |

## Project layout

- `main.js`: the Electron main process: tray, popover window, global shortcut, IPC handlers
- `paste.js`: Insert, pasting into the previous app through the `sendpaste` helper
- `selection.js`: what ⌘⇧M does with the selected text; pure Node, unit-tested
- `settings.js`: settings kept between launches (`userData/settings.json`)
- `recognize.js`: reading math from images with Apple Intelligence or Ollama
- `native/`: the Swift helpers and `build.js`, which compiles them
- `src/`: the renderer: `index.html`, `renderer.js`, `preload.js` and the icons
- `scripts/`: the signing setup and the build script
- `test/`: Playwright specs and `unit/` for `node:test`

Main-process modules live next to `main.js`, renderer code under `src/`; `electron-builder.yml` lists the main-process files one by one.

## Troubleshooting

### `npm start` or `npm run build` fails with "Cannot find module"

This usually happens when the `MacMath` folder is inside Desktop or Documents and iCloud Drive syncs those folders (the **Desktop & Documents Folders** option in iCloud Drive settings). While syncing the thousands of files in `node_modules`, iCloud can rename some of them, for example to `rebuild 3`, and the build can no longer find them. You'll see an error like `Cannot find module '@electron/rebuild'`.

To fix it, keep iCloud out of the folders npm and the build create, then reinstall. Run this in the project folder:

```sh
rm -rf node_modules
mkdir -p node_modules dist
xattr -w 'com.apple.fileprovider.ignore#P' 1 node_modules dist
npm install
```

iCloud then leaves `node_modules` and `dist` on your Mac only. The setting stays as long as you keep using `npm install`; if you ever delete `node_modules`, run these steps again.

You can also stop iCloud from syncing the whole project instead. Either move the folder out of Desktop and Documents, or rename it so it ends in `.nosync` (for example `MacMath.nosync`).

### The build says there is no signing identity

Run `npm run setup:signing` once; see [Signing](#signing).

### Insert or ⌘⇧M stopped working after a rebuild

The build was ad-hoc signed, for example by `npm start` or an older checkout. Build with `npm run build:dir`, then remove MacMath from Accessibility in System Settings and add it again once.

## Releasing

GitHub Actions makes a release when a merge to `main` changes the `version` in `package.json`: the Release workflow builds and signs the app, tags the commit `v<version>` and attaches the `.dmg` to a GitHub release of that tag. Merges that leave the version alone only run the tests. "Run workflow" on the Release workflow builds any branch and keeps the `.dmg` as a workflow artifact without releasing it.

Releases are signed with the same "MacMath Dev" identity every time, so that users keep the Accessibility permission across updates. The workflow takes it from two repository secrets and fails without them:

- `MACMATH_SIGNING_P12`: the identity exported from Keychain Access (login keychain → My Certificates → "MacMath Dev" → right-click → Export, format `.p12`, with a password), then base64-encoded: `base64 -i MacMath.p12 | pbcopy`
- `MACMATH_SIGNING_PASSWORD`: the password chosen for that export

Keep the exported `.p12` somewhere safe. Replacing it with a different certificate makes the next release a new app to macOS, and every user has to grant the Accessibility permission again.

Releases are not notarized, which needs the Apple Developer Program: the first launch of a downloaded copy is refused until the app is allowed under System Settings → Privacy & Security. The release note the workflow writes tells users so.
