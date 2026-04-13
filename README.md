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

## Install

Download the latest `.dmg` from [Releases](https://github.com/yblock/MacMath/releases), open it, and drag MacMath to Applications.

> The app is not code-signed. On first launch, right-click the app and choose **Open** to bypass Gatekeeper.

### Build from source

Requires [Node.js](https://nodejs.org/) 18+.

```sh
git clone https://github.com/yblock/MacMath.git
cd MacMath
npm install
npm start
```

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

## Build

```sh
npm run build        # .app + .dmg
npm run build:dir    # .app only (faster)
```

Output goes to `dist/`.

## License

MIT
