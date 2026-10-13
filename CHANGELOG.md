# Changelog

All notable changes to MacMath. Versions match the `version` in `package.json`.

**Updating?** Get the latest code, then run `npm install` before `npm start` or `npm run build`. See [Updating MacMath](README.md#updating-macmath).

## 1.4.0 - 2026-10-13

Run `npm install` after updating to this version: it adds mhchem's parser.

### Added

- A chemistry keyboard: choose **H₂O** in the virtual keyboard for isotopes, elements, counts, charges, arrows (reaction, equilibrium, resonance, with conditions), gas and precipitate arrows, states and common constants.
- mhchem's `\ce{…}` and `\pu{…}` (for example `\ce{2H2 + O2 -> 2H2O}`) are copied as MathML. Before, MathLive drew them but Copy MathML left them out.
- Reading an image of chemistry: element symbols are upright, and a symbol in isotope notation that isn't an element is corrected when one letter was clearly misread (³Hc becomes ³He; an atomic number decides between lookalikes). Scripts the model puts inside `\mathrm{}` move out of it (`\mathrm{^{14}_{6}C}` becomes `{}^{14}_{6}\mathrm{C}`). On 25 rendered chemistry formulas with qwen2.5vl:7b: 25/25 (was 24/25), and 9/25 on low-quality copies (was 7/25).

### Fixed

- Isotopes and other left scripts ({}^{3}He, {}_{92}^{235}U, {}_nC_r) are copied as `<mmultiscripts>` prescripts. Word showed an empty box for the old empty base.
- `\longrightarrow`, `\longleftarrow` and `\longleftrightarrow` in copied MathML: the arrow was lost and took the next symbol with it.
- `\xrightarrow[below]{above}`, `\xleftrightarrow` and `\xrightleftharpoons` keep their arrows and labels in copied MathML, and import back.
- Math inside text from an image (`\text{$…$}`) becomes plain math, and text keeps its space after a variable (`x\text{ be the number}`).
- With a MathML prefix, `<none/>` gets it too.

## 1.3.2 - 2026-10-13

Run `npm install` after updating to this version.

### Security

- Updated Electron from 44.5.1 to 44.7.1, which includes security fixes from Chromium (152.0.7977.149), V8, Skia, ANGLE and WebRTC.

### Fixed

- A rare crash at launch when macOS refused to register MacMath for sleep and wake notifications (from Electron 44.6.0).

## 1.3.1 - 2026-10-13

Run `npm install` after updating to this version.

### Security

- Updated MathLive to 0.111.1, which fixes cross-site scripting issues in how it renders LaTeX (`\enclose`, `\href`, `\htmlData`, and colors and other style values). LaTeX pasted or imported into MacMath could have run script in the editor window.

### Fixed

- In copied MathML, `\bbox` backgrounds have their color, and `\enclose{box}` keeps its border options (from MathLive 0.111.1).

## 1.3.0 - 2026-10-13

### Added

- `Cmd+I` makes math letters upright (`\mathrm`), for labels like the v in F<sub>v</sub>, and switches them back to italic. In text it toggles italic. Upright letters are copied to MathML as `mathvariant="normal"`.

### Changed

- Reading math from images is more accurate. MacMath fills a transparent background with white first: on transparent images of formulas, the recommended model went from 0 of 30 right (it made up text) to 28 of 30. It also crops the image to the math and enlarges small formulas, for both Apple Intelligence and Ollama.
- Upright and bold letters read from images stay math: `\mathbf{F}_{\mathrm{net}}` instead of `\text{F}_{\text{net}}`, which copied as text in MathML.
- MathML import keeps upright letters: `mathvariant="normal"` comes back as `\mathrm`, and multi-letter identifiers such as `<mi>Var</mi>` as `\operatorname` (they were split into italic letters).

### Fixed

- HEIC, TIFF, GIF, BMP and WebP images couldn't be read. Only PNG and JPEG worked.
- `Cmd+B` on selected text applied math bold, which had no effect. It now makes the text bold.
- Copied MathML was wrong or incomplete for:
  - `1{,}000`, which became the decimal `1.000`.
  - `\binom`, now a fraction with no line.
  - Isotopes like `{}^{14}\mathrm{C}`, which were invalid MathML.
  - `\overrightarrow`, `\underbrace`, `\overbrace`, `\xrightarrow`, `\mathring`, `\widehat`, `\widetilde`, `\mathcal`, `\pmod`, `\dots` and `\iff`, which lost their content, symbol or font.

  Letters before `=` (`g=9.8`) no longer get a function-application operator, and `|x|` uses operators instead of identifiers.
- MathML import kept more of the original:
  - Spacing: `\,`, `\:`, `\quad`, `\qquad` and `\!` all came back as `\;`.
  - Braces, `%` and `$`: `\{x\}` lost its braces and `50\%` became `50`.
  - Symbols: `\varepsilon`, `\varphi`, `\parallel` and `\mid`, plus symbols that came back as raw Unicode characters.
  - Accents (`\bar`, `\ddot`, `\check` and others) and primes (`f''`).
  - Isotopes, including `<mmultiscripts>`.
  - Matrices, which now come back as `pmatrix`, `bmatrix`, `vmatrix` or `cases`, and `\binom`.
  - `<mfenced>` separators.
  - Font variants: `\mathbb`, `\mathcal`, `\mathfrak`, `\mathsf` and `\mathtt`, from `mathvariant` or from characters like `ℝ`.
- With many history entries, the rows were squeezed into each other. The list now scrolls.

## 1.2.0 - 2026-10-05

### Added

- Turn an image of math into an editable expression. Paste a screenshot or an image file copied in Finder with `Cmd+V`, click **Import** then **Image…**, or drag an image file onto the menu bar icon. The image is read on your Mac, never uploaded, by either:
  - Apple Intelligence, on macOS 27 or later. This needs the macOS 27 SDK (Xcode or the Command Line Tools) when you run `npm install`.
  - Any vision model you've installed with [Ollama](https://ollama.com), such as `qwen2.5vl`.

  Pick one under **Import** → **Read images with**. **Automatic** uses Apple Intelligence when it's available, otherwise Ollama.
- If nothing on your Mac can read images yet, **Import** walks you through setting up Ollama: open its download page, start it, and download the recommended model with a progress bar: `qwen2.5vl:7b` when your Mac has the memory for it, otherwise `qwen2.5vl:3b`.
- MacMath has Ollama unload the model 30 seconds after the last image and when MacMath quits. Models too large for your Mac's memory can't be chosen.
- A spinner with a seconds counter covers the editor while an image is read.
- MacMath tidies the LaTeX models write: matrices, determinants and case splits come back as `pmatrix`, `bmatrix`, `vmatrix` and `cases` rather than `array`, without extra braces or letter-by-letter spacing.

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
- Bold now survives in copied MathML. Bold digits, Greek letters and text (`\mathbf{2}`, `\boldsymbol{\alpha}`, `\textbf{…}`) used to come out plain.
- Copied MathML is now valid XML. Symbols such as `≠` were written as HTML entities (`&ne;`), which break XML documents; they're now numeric references (`&#8800;`).
- Copying no longer depends on the popover having keyboard focus.
- Importing MathML:
  - Symbols such as `×`, `≤` and `∈` followed by a letter produced broken LaTeX (`a\timesb` instead of `a\times b`).
  - Invisible operators, such as the implied multiplication in `2x`, were kept as hidden characters in the LaTeX.
  - Function names such as `sin`, `log` and `lim` came in as separate italic letters, and limits as `\underset`.
  - Greek letters stayed as raw Unicode characters instead of `\alpha` and so on.
  - Bold was lost. Bold from `mathvariant="bold"` (also on an enclosing `<mstyle>`), MathML 2's `fontweight="bold"`, or bold characters such as `𝐱` now comes back as `\mathbf`, `\boldsymbol` or `\textbf`.
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
