# MacMath

A macOS menu bar utility for writing math and copying it as LaTeX or MathML.

<p align="center">
  <img src="src/image.png" alt="MacMath" width="128" />
</p>

## Features

- **Visual math editor** with MathLive -- type or use the virtual keyboard
- **Resizable editor** -- drag a bottom corner to make the editor wider and taller for large equations, up to the edges of your screen
- **Copy as LaTeX or MathML** with one click or keyboard shortcut
- **Import** LaTeX or MathML to edit visually -- auto-detects format and namespace prefixes
- **MathML namespace prefix** -- set a custom prefix like `m:` or `mml:` for output
- **Expression history** -- recent expressions saved for quick re-use
- **Global shortcut** -- `Cmd+Shift+M` summons MacMath from any app
- **Bold and underline** -- `Cmd+B` and `Cmd+U` toggle formatting, exported to both LaTeX and MathML
- **Light and dark mode** -- follows system preference, with a manual toggle
- **Launch at login** -- option in the tray menu
- **Text mode** -- switch between math symbols and plain text input

<img width="516" height="750" alt="Screenshot 2026-10-01 at 12 32 15 PM" src="https://github.com/user-attachments/assets/627b47bc-3746-4317-8149-8544926a629e" />

## Choose How To Use It

You have two simple options:

1. **Run it directly from Terminal with `npm start`**
   This is the fastest option if you just want to use the app.

2. **Build a local `.dmg` on your own Mac**
   This is the better option if you want to drag MacMath into Applications and launch it like a normal app.

You do **not** need an Apple Developer account for either of these local options.

## Before You Start

You need:

- A Mac running macOS 13 (Ventura) or later
- [Node.js](https://nodejs.org/) 22.12 or newer (the LTS download from nodejs.org works)
- The MacMath source code folder on your machine

If you do not already have the project folder:

1. Go to the GitHub repository page.
2. Click **Code**.
3. Click **Download ZIP**.
4. Open the downloaded ZIP and extract it.
5. Move the extracted `MacMath` folder somewhere easy to find, like your Downloads folder. If iCloud Drive syncs your Desktop and Documents folders, avoid those, or see [Troubleshooting](#troubleshooting).

## Open The Project In Terminal

1. Open the **Terminal** app on your Mac.
2. Type `cd ` including the space after `cd`.
3. Drag the `MacMath` folder into the Terminal window.
   Terminal will paste the full folder path for you.
4. Press `Return`.

Example:

```sh
cd /Users/yourname/Downloads/MacMath
```

## Install The Required Packages

Run this once before using the app:

```sh
npm install
```

This may take a minute or two the first time.

## Option 1: Run It Immediately With `npm start`

Use this if you want the quickest path and do not care about installing MacMath into Applications.

Run:

```sh
npm start
```

What happens next:

1. MacMath starts running. The first time, it also downloads Electron (about 100 MB), so give it a minute.
2. Its icon appears in your menu bar.
3. Click the menu bar icon to open the editor.

Important notes:

- Leave the Terminal window open while MacMath is running.
- To quit the app, right-click its menu bar icon and choose **Quit MacMath**, or press `Control + C` in Terminal.
- When you update MacMath, run `npm install` again before launching. See [Updating MacMath](#updating-macmath).

## Option 2: Build A Local DMG And Install It

Use this if you want MacMath to behave more like a normal installed app.

Run:

```sh
npm run build
```

What this does:

- Builds the app locally on your Mac
- Creates a `dist` folder inside the project
- Puts a `.dmg` file there

When the build finishes:

1. Open the `MacMath` project folder in Finder.
2. Open the `dist` folder.
3. Double-click the generated `.dmg` file.
4. Drag **MacMath** into **Applications**.
5. Open **Applications** and launch MacMath.

## Which Option Should You Pick?

- Choose `npm start` if you want the fastest setup and are okay running it from Terminal.
- Choose `npm run build` if you want a local `.dmg` and an app you can keep in Applications.

## Updating MacMath

To get the latest version:

1. Get the newest code.
   - If you downloaded a ZIP: download a fresh ZIP from GitHub and replace your old `MacMath` folder with the new one.
   - If you cloned with git: run `git pull` in the project folder.
2. Open the project folder in Terminal (see [Open The Project In Terminal](#open-the-project-in-terminal)).
3. Install the updated packages:

   ```sh
   npm install
   ```

   **Do not skip this step.** Updates can change the packages MacMath depends on, and the editor won't load until they're installed. If `npm install` warns that your Node.js version is too old, install the current LTS from [nodejs.org](https://nodejs.org/) and run it again.
4. Start MacMath again:
   - With `npm start`: quit the running copy first (right-click the menu bar icon, then **Quit MacMath**), then run `npm start`.
   - With the `.dmg`: run `npm run build` again, then drag the new **MacMath** into **Applications** and replace the old one.

See [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

## Usage

1. Click the menu bar icon (or press `Cmd+Shift+M`) to open the editor
2. Type a math expression -- it renders live
3. Press `Cmd+Enter` to copy LaTeX, or `Cmd+Shift+Enter` for MathML
4. Paste into your document

Right-click the menu bar icon for **Launch at Login** and **Quit MacMath**.

To import an existing expression, click **Import** and paste LaTeX or MathML. The format is detected automatically, including namespace-prefixed MathML like `<m:math>`.

Need more room? Drag either bottom corner of the editor to resize it in both directions, or the handle at the bottom center to change only its height. MacMath never grows past the edges of your screen; if the virtual keyboard needs the space, the editor shrinks to fit. Double-click a handle to go back to the default size. Each time you reopen MacMath it starts at the default size again, with your expression still there.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Shift+M` | Toggle popover (works globally) |
| `Cmd+Enter` | Copy LaTeX |
| `Cmd+Shift+Enter` | Copy MathML |
| `Cmd+B` | Toggle bold |
| `Cmd+U` | Toggle underline on the selection |
| `Cmd+Z` | Undo |
| `Cmd+Shift+Z` | Redo |

## Commands

```sh
npm install
npm start
npm run build
npm run build:dir
```

- `npm install` installs the required packages
- `npm start` runs the app directly
- `npm run build` creates a local `.dmg`
- `npm run build:dir` creates the `.app` bundle without building the `.dmg`

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

## License

MIT
