// "⌘⇧M loads the selected formula" (issue #2, second half), tested at the main-process
// boundary: decideShortcut() in ../../selection.js is what the shortcut handler acts on.
// It gets the popover state and the selection reader (node-get-selected-text's function,
// injected so it can be faked here) and answers with
//   { action: 'hide' }                        popover showing: just hide, read nothing
//   { action: 'show', load: null }            nothing selected or unreadable: open as always
//   { action: 'show', load: { kind, text } }  open and replace the editor content
// The renderer half, loading into MathLive, is covered by test/load-selection.spec.js.
//
// Runs with plain Node (`npm run test:unit`), no Electron.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { decideShortcut } = require('../../selection.js');

// A reader that records whether it was asked, so tests can assert the popover rule
function reader(result) {
  const r = { calls: 0 };
  r.getSelectedText = () => {
    r.calls++;
    if (result instanceof Error) throw result;
    return result;
  };
  return r;
}

// `env` is passed explicitly so these tests never depend on the real environment
const NO_ENV = {};

function decide(result, overrides = {}) {
  const r = reader(result);
  const decision = decideShortcut({ popoverVisible: false, getSelectedText: r.getSelectedText, env: NO_ENV, ...overrides });
  return { decision, reads: r.calls };
}

describe('⌘⇧M while the popover is showing', () => {
  test('hides without reading: the front app would be MacMath itself', () => {
    const { decision, reads } = decide('\\alpha', { popoverVisible: true });
    assert.deepEqual(decision, { action: 'hide' });
    assert.equal(reads, 0);
  });
});

describe('⌘⇧M while the popover is hidden', () => {
  test('reads once and opens with a LaTeX selection, trimmed', () => {
    const { decision, reads } = decide('  \\frac{V}{R} = I \n');
    assert.deepEqual(decision, { action: 'show', load: { kind: 'latex', text: '\\frac{V}{R} = I' } });
    assert.equal(reads, 1);
  });

  test('opens with a MathML selection, prefixed or not', () => {
    const plain = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>';
    assert.deepEqual(decide(plain).decision, { action: 'show', load: { kind: 'mathml', text: plain } });

    const prefixed = '<m:math xmlns:m="http://www.w3.org/1998/Math/MathML"><m:mi>x</m:mi></m:math>';
    assert.deepEqual(decide(`\n  ${prefixed}  `).decision, { action: 'show', load: { kind: 'mathml', text: prefixed } });
  });

  test('a less-than sign inside LaTeX does not make it MathML', () => {
    assert.deepEqual(decide('a < b').decision, { action: 'show', load: { kind: 'latex', text: 'a < b' } });
  });

  test('dollar signs are not delimiters, just characters', () => {
    assert.deepEqual(decide('$x^2$').decision, { action: 'show', load: { kind: 'latex', text: '$x^2$' } });
  });

  test('prose loads too: the user selected it', () => {
    assert.deepEqual(decide('solve for V').decision, { action: 'show', load: { kind: 'latex', text: 'solve for V' } });
  });
});

describe('⌘⇧M with nothing to load opens exactly as before', () => {
  test('nothing selected', () => {
    for (const result of ['', '   \n\t ', null, undefined]) {
      assert.deepEqual(decide(result).decision, { action: 'show', load: null }, `for ${JSON.stringify(result)}`);
    }
  });

  test('the read fails (no Accessibility permission, app without a selection API)', () => {
    const { decision, reads } = decide(new Error('not trusted'));
    assert.deepEqual(decision, { action: 'show', load: null });
    assert.equal(reads, 1);
  });
});

describe('MACMATH_FAKE_SELECTION, the seam the end-to-end test uses', () => {
  test('replaces the library entirely', () => {
    const { decision, reads } = decide('real', { env: { MACMATH_FAKE_SELECTION: '\\sqrt{2}' } });
    assert.deepEqual(decision, { action: 'show', load: { kind: 'latex', text: '\\sqrt{2}' } });
    assert.equal(reads, 0);
  });

  test('an empty fake means "nothing selected", not "use the library"', () => {
    const { decision, reads } = decide('real', { env: { MACMATH_FAKE_SELECTION: '' } });
    assert.deepEqual(decision, { action: 'show', load: null });
    assert.equal(reads, 0);
  });

  test('does not read while the popover is showing either', () => {
    const { decision, reads } = decide('real', { popoverVisible: true, env: { MACMATH_FAKE_SELECTION: 'x' } });
    assert.deepEqual(decision, { action: 'hide' });
    assert.equal(reads, 0);
  });
});
