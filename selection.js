// What ⌘⇧M does with the text selected in the app in front (issue #2, second half).
// Pure Node, no Electron: unit-tested in test/unit/selection.test.js through decideShortcut.
//
// The read itself is done by node-get-selected-text: the Accessibility API first and,
// when the app does not expose its selection, a simulated ⌘C with the clipboard restored.
// Both need the Accessibility permission. The library is injected so tests can fake it.

// Same rule as the Import box: text starting with '<' is MathML, anything else LaTeX.
// No delimiter handling: a '$' is just a character of the formula.
function classifySelection(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return { kind: 'empty' };
  return { kind: trimmed.startsWith('<') ? 'mathml' : 'latex', text: trimmed };
}

// The selected text, or '' when nothing is selected or the read fails. When
// MACMATH_FAKE_SELECTION is set (tests), its value stands in for the library.
function readSelection({ getSelectedText, env = process.env }) {
  const fake = env.MACMATH_FAKE_SELECTION;
  if (fake !== undefined) return fake;
  try {
    const text = getSelectedText();
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}

// The decision behind the ⌘⇧M handler:
//   { action: 'hide' }                      the popover is showing: the front app is MacMath
//                                           itself, so there is nothing to read; just hide
//   { action: 'show', load: null }          nothing selected (or unreadable): open as always
//   { action: 'show', load: { kind, text } } open and replace the editor content
// The selection is read only when the popover is hidden, i.e. while the user's text field
// still has focus.
function decideShortcut({ popoverVisible, getSelectedText, env = process.env }) {
  if (popoverVisible) return { action: 'hide' };
  const selection = classifySelection(readSelection({ getSelectedText, env }));
  return { action: 'show', load: selection.kind === 'empty' ? null : selection };
}

module.exports = { decideShortcut, classifySelection, readSelection };
