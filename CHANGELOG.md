# Changelog

All notable changes to MacMath. Versions match the `version` in `package.json`.

**Updating?** Get the latest code, then run `npm install` before `npm start` or `npm run build`. See [Updating MacMath](README.md#updating-macmath).

## 1.1.0 - 2026-10-01

Run `npm install` after updating to this version. MacMath now uses newer versions of Electron and MathLive, and the editor won't load until they're installed.

This version needs **macOS 13 (Ventura) or later** and **Node.js 22.12 or later**.

### Added

- Drag either bottom corner of the editor to make it wider and taller for large equations. MacMath never grows past the edges of your screen; if the virtual keyboard needs the room, the editor shrinks to fit. Each time you reopen MacMath it starts at the default size, and your expression is kept.
- `Cmd+B` toggles bold and `Cmd+U` toggles underline (contributed by [@JussiRoos](https://github.com/JussiRoos) in [#1](https://github.com/yblock/MacMath/pull/1)). Underlines are included when you copy MathML, and imported MathML underlines come back as `\underline`.

### Changed

- Electron upgraded from 34 to 44. Version 34 no longer received security updates. The first `npm start` after updating downloads Electron, which takes a minute.
- MathLive upgraded from 0.103 to 0.111. This brings many editor fixes. The virtual keyboard shows undo, redo and paste buttons, and the editor menu no longer has Evaluate, Simplify or Solve.
- Numbers typed like `3e2` stay as typed. MathLive would otherwise rewrite them as `3\times10^{2}`.
- The editor no longer remembers a custom height between openings.
- The popover opens on the desktop (Space) you're currently using, including over full-screen apps.
- Licensed under MIT again.

### Fixed

- `Cmd+Enter` turned the expression into `\displaylines{…}` with an empty line before copying it.
- Overlined expressions (`\overline`) were missing from copied MathML.
- Copied MathML is now valid XML. Symbols such as `≠` were written as HTML entities (`&ne;`), which break XML documents; they're now numeric references (`&#8800;`).
- Copying no longer depends on the popover having keyboard focus.
- Importing MathML:
  - Symbols such as `×`, `≤` and `∈` followed by a letter produced broken LaTeX (`a\timesb` instead of `a\times b`).
  - Invisible operators, such as the implied multiplication in `2x`, were kept as hidden characters in the LaTeX.
  - Function names such as `sin`, `log` and `lim` came in as separate italic letters, and limits as `\underset`.
  - Greek letters stayed as raw Unicode characters instead of `\alpha` and so on.
  - MathML containing entities such as `&ne;` could not be imported.
- `npm run build` packed everything in the project folder into the app, including local, untracked folders. The app's contents dropped from 665 MB to under 6 MB.

## 1.0.1 - 2026-04-15

### Changed

- MacMath no longer shows a Dock icon, both in the built app and with `npm start`.
- Licensed under CC BY 4.0.

## 1.0.0 - 2026-04-12

First release.

- Visual math editor with MathLive: type or use the virtual keyboard
- Copy as LaTeX or MathML with one click or a keyboard shortcut
- Import LaTeX or MathML to edit visually, with automatic format and namespace-prefix detection
- Custom MathML namespace prefix such as `m:` or `mml:`
- Expression history for quick re-use
- Global shortcut `Cmd+Shift+M` to open MacMath from any app
- Light and dark mode, following the system or set manually
- Launch at login, from the menu bar icon's right-click menu
- Text mode for plain text input
