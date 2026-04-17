# MacMath

A macOS menu bar utility for writing math and copying it as LaTeX or MathML.

<p align="center">
  <img src="src/image.png" alt="MacMath" width="128" />
</p>

## Features

- **Visual math editor** with MathLive -- type or use the virtual keyboard
- **Copy as LaTeX or MathML** with one click or keyboard shortcut
- **Import** LaTeX or MathML to edit visually -- auto-detects format and namespace prefixes
- **MathML namespace prefix** -- set a custom prefix like `m:` or `mml:` for output
- **Expression history** -- recent expressions saved for quick re-use
- **Global shortcut** -- `Cmd+Shift+M` summons MacMath from any app
- **Light and dark mode** -- follows system preference, with a manual toggle
- **Launch at login** -- option in the tray menu
- **Text mode** -- switch between math symbols and plain text input

## Choose How To Use It

You have two simple options:

1. **Run it directly from Terminal with `npm start`**
   This is the fastest option if you just want to use the app.

2. **Build a local `.dmg` on your own Mac**
   This is the better option if you want to drag MacMath into Applications and launch it like a normal app.

You do **not** need an Apple Developer account for either of these local options.

## Before You Start

You need:

- A Mac
- [Node.js](https://nodejs.org/) 18 or newer
- The MacMath source code folder on your machine

If you do not already have the project folder:

1. Go to the GitHub repository page.
2. Click **Code**.
3. Click **Download ZIP**.
4. Open the downloaded ZIP and extract it.
5. Move the extracted `MacMath` folder somewhere easy to find, like your Desktop or Downloads folder.

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

1. MacMath starts running.
2. Its icon appears in your menu bar.
3. Click the menu bar icon to open the editor.

Important notes:

- Leave the Terminal window open while MacMath is running.
- To quit the app, close it from the menu bar or press `Control + C` in Terminal.
- If you update the project later, run `npm install` again before launching.

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

If you ever want to rebuild it after updating the code, run `npm run build` again.

## Which Option Should You Pick?

- Choose `npm start` if you want the fastest setup and are okay running it from Terminal.
- Choose `npm run build` if you want a local `.dmg` and an app you can keep in Applications.

## Usage

1. Click the menu bar icon (or press `Cmd+Shift+M`) to open the editor
2. Type a math expression -- it renders live
3. Press `Cmd+Enter` to copy LaTeX, or `Cmd+Shift+Enter` for MathML
4. Paste into your document

To import an existing expression, click **Import** and paste LaTeX or MathML. The format is detected automatically, including namespace-prefixed MathML like `<m:math>`.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Shift+M` | Toggle popover (works globally) |
| `Cmd+Enter` | Copy LaTeX |
| `Cmd+Shift+Enter` | Copy MathML |
| `Cmd+Z` | Undo |

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

## License

MIT
