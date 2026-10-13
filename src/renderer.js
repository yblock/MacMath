const MATHLIVE_MENU_SWATCH_FIX_ATTR = 'data-macmath-menu-swatch-fix';
const MATHLIVE_MENU_SWATCH_FIX_CSS = `
.menu-swatch.active {
  background: transparent !important;
}

.menu-swatch.active > .label > span {
  border-radius: 50% !important;
}
`;

function installMathLiveMenuSwatchFix(shadowRoot) {
  if (!(shadowRoot instanceof ShadowRoot)) return;
  if (shadowRoot.host?.tagName !== 'MATH-FIELD') return;
  if (shadowRoot.querySelector(`style[${MATHLIVE_MENU_SWATCH_FIX_ATTR}]`)) return;

  const style = document.createElement('style');
  style.setAttribute(MATHLIVE_MENU_SWATCH_FIX_ATTR, '');
  style.textContent = MATHLIVE_MENU_SWATCH_FIX_CSS;
  shadowRoot.appendChild(style);
}

const MATHLIVE_ATTACH_SHADOW_PATCH = Symbol.for('macmath.mathlive.attachShadowPatch');

if (!Element.prototype.attachShadow[MATHLIVE_ATTACH_SHADOW_PATCH]) {
  const originalAttachShadow = Element.prototype.attachShadow;

  // MathLive mounts its context menu inside the mathfield shadow root.
  const patchedAttachShadow = function attachShadowWithMathLiveFix(init) {
    const shadowRoot = originalAttachShadow.call(this, init);

    if (this instanceof HTMLElement && this.tagName === 'MATH-FIELD') {
      queueMicrotask(() => installMathLiveMenuSwatchFix(shadowRoot));
    }

    return shadowRoot;
  };

  patchedAttachShadow[MATHLIVE_ATTACH_SHADOW_PATCH] = true;
  Element.prototype.attachShadow = patchedAttachShadow;
}

window.addEventListener('DOMContentLoaded', () => {
  const mathField = document.getElementById('mathfield');
  const editorContainer = document.getElementById('editorContainer');
  const latexPreview = document.getElementById('latexPreview');
  const copyLaTeXBtn = document.getElementById('copyLaTeXBtn');
  const copyMathMLBtn = document.getElementById('copyMathMLBtn');
  const importToggle = document.getElementById('importToggle');
  const importSection = document.getElementById('importSection');
  const importInput = document.getElementById('importInput');
  const importHint = document.getElementById('importHint');
  const importBtn = document.getElementById('importBtn');
  const imageBtn = document.getElementById('imageBtn');
  const engineSelect = document.getElementById('engineSelect');
  const setupRow = document.getElementById('setupRow');
  const setupText = document.getElementById('setupText');
  const setupBtn = document.getElementById('setupBtn');
  const nsPrefix = document.getElementById('nsPrefix');
  const nsExample = document.getElementById('nsExample');
  const appBottomAnchor = document.querySelector('.namespace-row');

  customElements.whenDefined('math-field').then(() => {
    installMathLiveMenuSwatchFix(mathField.shadowRoot);
  });

  mathField.mathVirtualKeyboardPolicy = 'manual';
  // Keep numbers as typed: MathLive would otherwise rewrite 3e2 as 3\times10^{2}.
  MathfieldElement.scientificNotationTemplate = '';

  // --- Theme toggle ---

  const themeToggle = document.getElementById('themeToggle');
  let themeOverride = null; // null = follow system

  function isDark() {
    if (themeOverride) return themeOverride === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme() {
    if (themeOverride) {
      document.documentElement.setAttribute('data-theme', themeOverride);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  themeToggle.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Prevent mathfield blur
  });

  themeToggle.addEventListener('click', () => {
    if (themeOverride === null) {
      themeOverride = isDark() ? 'light' : 'dark';
    } else {
      themeOverride = themeOverride === 'dark' ? 'light' : 'dark';
    }
    applyTheme();
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!themeOverride) applyTheme();
  });

  // --- Virtual keyboard and window size ---

  const BASE_WIDTH = 520;
  const BASE_HEIGHT = 380;
  const DEFAULT_EDITOR_HEIGHT = 80;
  const kbContainer = document.getElementById('keyboardContainer');
  const resizeHandles = editorContainer.querySelectorAll('[data-resize]');
  // Largest window that stays on screen; sent by the main process when the popover opens
  let windowLimits = { maxWidth: Infinity, maxHeight: Infinity };
  let windowWidth = BASE_WIDTH;
  let editorHeight = DEFAULT_EDITOR_HEIGHT;
  let appliedEditorHeight = null;
  let editorResizeState = null;
  // 'right' keeps the window's right edge in place while the left corner widens it
  let resizeAnchor = 'left';
  let syncFrame = 0;

  setEditorHeight(editorHeight);

  mathVirtualKeyboard.container = kbContainer;

  function setEditorHeight(height) {
    if (height === appliedEditorHeight) return;
    appliedEditorHeight = height;
    document.documentElement.style.setProperty('--editor-height', `${height}px`);
  }

  function contentHeight() {
    const paddingBottom = Number.parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    return Math.ceil(appBottomAnchor.getBoundingClientRect().bottom + paddingBottom);
  }

  // Applies the editor height, shrinking it (never below the default) when the
  // app would otherwise run past the bottom of the screen. Returns the height used.
  function fitEditorHeight(height) {
    // The content grows one-for-one with the editor, so one measurement is enough
    const tallest = windowLimits.maxHeight - contentHeight() + appliedEditorHeight;
    const fitted = Math.max(DEFAULT_EDITOR_HEIGHT, Math.min(Math.round(height), Math.floor(tallest)));
    setEditorHeight(fitted);
    return fitted;
  }

  function syncWindowSize() {
    if (!window.electronAPI?.resizeWindow || syncFrame) return;

    syncFrame = requestAnimationFrame(() => {
      syncFrame = 0;
      fitEditorHeight(editorHeight);
      const width = Math.min(windowWidth, windowLimits.maxWidth);
      const height = Math.min(Math.max(BASE_HEIGHT, contentHeight()), windowLimits.maxHeight);
      window.electronAPI.resizeWindow(width, height, resizeAnchor);
    });
  }

  function resetEditorSize() {
    windowWidth = BASE_WIDTH;
    resizeAnchor = 'left';
    editorHeight = fitEditorHeight(DEFAULT_EDITOR_HEIGHT);
    syncWindowSize();
  }

  // data-resize: 'height' (bottom handle), or 'left' / 'right' (bottom corners)
  for (const handle of resizeHandles) {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const mode = handle.dataset.resize;
      resizeAnchor = mode === 'left' ? 'right' : 'left';
      // Screen coordinates: the window itself moves while the left corner is dragged
      editorResizeState = {
        mode,
        startX: event.screenX,
        startY: event.screenY,
        startWidth: windowWidth,
        startHeight: editorHeight
      };
      editorContainer.classList.add('resizing');
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener('pointermove', (event) => {
      if (!editorResizeState) return;
      const { mode, startX, startY, startWidth, startHeight } = editorResizeState;
      if (mode !== 'height') {
        const deltaX = (event.screenX - startX) * (mode === 'left' ? -1 : 1);
        windowWidth = Math.max(BASE_WIDTH, Math.min(windowLimits.maxWidth, Math.round(startWidth + deltaX)));
      }
      editorHeight = fitEditorHeight(startHeight + event.screenY - startY);
      syncWindowSize();
    });

    const stopEditorResize = (event) => {
      if (!editorResizeState) return;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      editorResizeState = null;
      editorContainer.classList.remove('resizing');
    };
    handle.addEventListener('pointerup', stopEditorResize);
    handle.addEventListener('pointercancel', stopEditorResize);

    handle.addEventListener('dblclick', (event) => {
      event.preventDefault();
      resetEditorSize();
    });
  }

  // Each opening starts at the default size; the expression is kept
  window.electronAPI?.onPopoverHidden?.(resetEditorSize);
  window.electronAPI?.onPopoverShown?.((limits) => {
    windowLimits = limits;
    syncWindowSize();
  });
  window.addEventListener('resize', syncWindowSize);

  mathField.addEventListener('focusin', () => mathVirtualKeyboard.show());

  mathField.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!mathField.matches(':focus-within') && !mathField.matches(':focus')) {
        mathVirtualKeyboard.hide();
      }
    }, 150);
  });

  mathVirtualKeyboard.addEventListener('geometrychange', () => {
    syncWindowSize();
  });

  // --- Text mode toggle ---

  const textToggle = document.getElementById('textToggle');

  textToggle.addEventListener('mousedown', (e) => e.preventDefault());

  textToggle.addEventListener('click', () => {
    const newMode = mathField.mode === 'text' ? 'math' : 'text';
    mathField.executeCommand(['switchMode', newMode]);
    mathField.focus();
  });

  // Update toggle state when mode changes
  mathField.addEventListener('mode-change', () => {
    if (mathField.mode === 'text') {
      textToggle.classList.add('active');
    } else {
      textToggle.classList.remove('active');
    }
  });

  // --- Live preview ---

  mathField.addEventListener('input', () => {
    latexPreview.textContent = mathField.getValue('latex');
  });

  // --- Clipboard ---

  function copyToClipboard(text) {
    const electronCopy = window.electronAPI?.copyText
      ? window.electronAPI.copyText(text)
      : Promise.reject(new Error('Electron clipboard bridge unavailable'));

    return electronCopy.catch(() => navigator.clipboard.writeText(text));
  }

  const copyBtnTimers = new Map();

  function flashCopied(btn) {
    // Clear any existing timer to prevent race conditions
    if (copyBtnTimers.has(btn)) clearTimeout(copyBtnTimers.get(btn));

    // Store original HTML on first call (preserves .shortcut spans)
    if (!btn.dataset.originalHtml) {
      btn.dataset.originalHtml = btn.innerHTML;
    }

    btn.classList.add('copied');
    btn.innerHTML = 'Copied!';

    const timer = setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = btn.dataset.originalHtml;
      copyBtnTimers.delete(btn);
    }, 1200);
    copyBtnTimers.set(btn, timer);
  }

  // --- Keyboard shortcuts ---

  // Cmd+Enter copies (below). MathLive also binds it to "add row", which would
  // turn the expression into \displaylines{...} before it is copied.
  mathField.keybindings = mathField.keybindings.filter(
    (binding) => !/^cmd\+\[(Return|Enter)\]$/.test(binding.key)
  );

  // Cmd+B / Cmd+I / Cmd+U: capture phase, so MathLive never sees a handled keystroke
  mathField.addEventListener('keydown', (e) => {
    if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const key = e.key.toLowerCase();
    const handled = key === 'b' ? toggleBold()
      : key === 'i' ? toggleUpright()
      : key === 'u' ? toggleUnderline()
      : false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Math bold is a variant style (\mathbf); text bold is a font series (\textbf)
  function toggleBold() {
    return toggleStyle({ variantStyle: 'bold' }, { fontSeries: 'b' });
  }

  // Math letters are italic, so Cmd+I switches them to upright (\mathrm) and back;
  // text is upright, so there it toggles italic (\textit)
  function toggleUpright() {
    // \mathbf is already upright, and MathLive's bold italic loses its bold in MathML
    if (!textSelected() && mathField.queryStyle({ variantStyle: 'bold' }) === 'all') return true;
    return toggleStyle({ variantStyle: 'up' }, { fontShape: 'it' });
  }

  function toggleStyle(mathStyle, textStyle) {
    if (mathField.mode === 'latex') return false;
    const style = textSelected() ? textStyle : mathStyle;
    if (mathField.selectionIsCollapsed && style.variantStyle && mathField.queryStyle(style) === 'all') {
      // With no selection, applyStyle can turn variantStyle on but never off
      mathField.executeCommand(['applyStyle', { variantStyle: '' }]);
    } else {
      mathField.executeCommand(['applyStyle', style]);
    }
    return true;
  }

  // In text, or a selection that is all text: mathField.mode says 'math' for a selection
  // made inside \text{…}, so check the selected LaTeX too
  function textSelected() {
    if (mathField.mode === 'text') return true;
    if (mathField.selectionIsCollapsed) return false;
    const selected = mathField.getValue(mathField.selection, 'latex');
    const open = selected.match(/^\\text[a-z]*\{/)?.[0].length - 1;
    return open > 0 && findClosingBrace(selected, open) === selected.length - 1;
  }

  function toggleUnderline() {
    if (mathField.mode === 'latex' || mathField.selectionIsCollapsed) return false;
    const selected = mathField.getValue(mathField.selection, 'latex');
    if (!selected) return false;
    // Insert as math LaTeX: in text mode a plain insert types the source literally
    mathField.insert(underlineArgument(selected) ?? `\\underline{${selected}}`, {
      format: 'latex',
      mode: 'math',
      selectionMode: 'item',
    });
    return true;
  }

  // '\underline{a}' → 'a', but '\underline{a}+\underline{b}' → null
  function underlineArgument(latex) {
    const command = '\\underline';
    if (!latex.startsWith(`${command}{`)) return null;
    const close = findClosingBrace(latex, command.length);
    return close === latex.length - 1 ? latex.slice(command.length + 1, close) : null;
  }

  // Index of the } matching the { at openIndex, or -1. Skips escapes like \{ and \}.
  function findClosingBrace(latex, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < latex.length; i++) {
      const ch = latex[i];
      if (ch === '\\') i++;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return i;
    }
    return -1;
  }

  document.addEventListener('keydown', (e) => {
    // Don't trigger copy shortcuts when typing in text inputs
    const tag = e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;

    if (e.metaKey && e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        copyMathMLBtn.click();
      } else {
        copyLaTeXBtn.click();
      }
    }
  });

  // --- Expression history ---

  const MAX_HISTORY = 10;
  let expressionHistory = [];
  const historySection = document.getElementById('historySection');
  const historyList = document.getElementById('historyList');
  const clearHistoryBtn = document.getElementById('clearHistory');

  function addToHistory(latex) {
    if (!latex || latex.trim() === '') return;
    expressionHistory = expressionHistory.filter(h => h !== latex);
    expressionHistory.unshift(latex);
    if (expressionHistory.length > MAX_HISTORY) expressionHistory.pop();
    renderHistory();
  }

  function renderHistory() {
    historyList.innerHTML = '';
    if (expressionHistory.length === 0) {
      historySection.classList.remove('has-items');
      syncWindowSize();
      return;
    }
    historySection.classList.add('has-items');
    for (const latex of expressionHistory) {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.textContent = latex;
      item.title = 'Click to load into editor';
      item.addEventListener('mousedown', (e) => e.preventDefault());
      item.addEventListener('click', () => {
        mathField.setValue(latex);
        latexPreview.textContent = mathField.getValue('latex');
        mathField.focus();
      });
      historyList.appendChild(item);
    }
    syncWindowSize();
  }

  clearHistoryBtn.addEventListener('mousedown', (e) => e.preventDefault());
  clearHistoryBtn.addEventListener('click', () => {
    expressionHistory = [];
    renderHistory();
  });

  copyLaTeXBtn.addEventListener('click', () => {
    const latex = mathField.getValue('latex');
    if (latex) {
      addToHistory(latex);
      copyToClipboard(latex).then(() => flashCopied(copyLaTeXBtn));
    }
  });

  copyMathMLBtn.addEventListener('click', () => {
    const inner = getMathML();
    if (inner) {
      const latex = mathField.getValue('latex');
      addToHistory(latex);
      const prefix = nsPrefix.value.trim();
      const mathml = applyNamespacePrefix(inner, prefix);
      copyToClipboard(mathml).then(() => flashCopied(copyMathMLBtn));
    }
  });

  // --- MathML export ---

  // MathLive's MathML serializer drops some things: \underline and \overline
  // along with their contents, the bold of digits, Greek letters and text
  // (\mathbf{2}, \boldsymbol{\alpha}, \textbf{hi}), the base of stretchy
  // arrows and braces (\overrightarrow{AB}, \underbrace{a+b}, \xrightarrow{f}),
  // and \phantom, \hphantom and \vphantom with their contents.
  // Each of these commands is wrapped in \underset/\overset with a marker,
  // which MathLive does serialize, and the marker is then turned into the right MathML.
  const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
  // Marker -> the mathvariant its tokens get
  const VARIANT_MARKERS = { MacMathBold: 'bold', MacMathScript: 'script' };
  // Marker -> the stretchy operator that replaces it
  const STRETCHY_MARKERS = {
    MacMathUnderline: '\u203E',
    MacMathOverline: '\u203E',
    MacMathOverRightArrow: '\u2192',
    MacMathOverLeftArrow: '\u2190',
    MacMathUnderbrace: '\u23DF',
    MacMathOverbrace: '\u23DE',
    MacMathRightArrow: '\u2192',
    MacMathLeftArrow: '\u2190',
  };
  // Marker -> the <mpadded> attributes inside its <mphantom>: \hphantom has no height or depth,
  // \vphantom no width (how Word's mathml2omml.xsl reads a smashed phantom)
  const PHANTOM_MARKERS = {
    MacMathPhantom: null,
    MacMathHPhantom: { height: '0', depth: '0' },
    MacMathVPhantom: { width: '0' },
  };
  // The marker is the script, the argument the base: \underset{\text{marker}}{{argument}}.
  // For \xrightarrow the argument is the script over a marker arrow.
  const script = (standIn, marker) => [`${standIn}{\\text{${marker}}}{{`, '}}'];
  const MARKED_COMMANDS = [
    { command: '\\underline', wrap: script('\\underset', 'MacMathUnderline') },
    { command: '\\overline', wrap: script('\\overset', 'MacMathOverline') },
    { command: '\\overrightarrow', wrap: script('\\overset', 'MacMathOverRightArrow') },
    { command: '\\overleftarrow', wrap: script('\\overset', 'MacMathOverLeftArrow') },
    { command: '\\underbrace', wrap: script('\\underset', 'MacMathUnderbrace') },
    { command: '\\overbrace', wrap: script('\\overset', 'MacMathOverbrace') },
    { command: '\\xrightarrow', wrap: ['\\overset{', '}{\\text{MacMathRightArrow}}'] },
    { command: '\\xleftarrow', wrap: ['\\overset{', '}{\\text{MacMathLeftArrow}}'] },
    // \hphantom and \vphantom first: \phantom{ is also found inside them
    { command: '\\hphantom', wrap: script('\\underset', 'MacMathHPhantom') },
    { command: '\\vphantom', wrap: script('\\underset', 'MacMathVPhantom') },
    { command: '\\phantom', wrap: script('\\underset', 'MacMathPhantom') },
    // Font commands stay inside the marker so MathLive still renders them
    ...['\\mathbf', '\\boldsymbol', '\\bm', '\\textbf'].map((command) => (
      { command, wrap: script('\\underset', 'MacMathBold'), keep: true }
    )),
    { command: '\\mathcal', wrap: script('\\underset', 'MacMathScript'), keep: true },
  ];
  // Other LaTeX MathLive serializes wrongly, rewritten before serializing:
  // {,} became a decimal point (1{,}000 -> 1.000), \widehat an "undefined" accent,
  // \dots an error, \iff nothing
  const COMMA_MARKER = 'MacMathComma';
  const EXPORT_REWRITES = [
    [/\{,\}/g, `\\text{${COMMA_MARKER}}`],
    [/\\widehat(?![a-zA-Z])/g, '\\hat'],
    [/\\widetilde(?![a-zA-Z])/g, '\\tilde'],
    [/\\dots(?![a-zA-Z])/g, '\\ldots'],
    [/\\iff(?![a-zA-Z])/g, '\\Longleftrightarrow'],
    // \pmod and \bmod come out as errors, \mathbin{…} and the like as nothing
    [/\\pmod\s*(\{[^{}]*\}|\\[a-zA-Z]+|\S)/g, '\\quad(\\operatorname{mod}\\,$1)'],
    [/\\bmod(?![a-zA-Z])/g, '\\operatorname{mod}'],
    [/\\math(bin|rel|op|ord|open|close|punct|inner)\s*\{/g, '{'],
  ];

  // Mathematical Alphanumeric Symbols used for bold, such as 𝐱, 𝛂 and 𝟐
  const UNICODE_BOLD = [
    [0x1D400, 0x1D433, 'bold'], // Latin
    [0x1D468, 0x1D49B, 'bold-italic'],
    [0x1D6A8, 0x1D6E1, 'bold'], // Greek
    [0x1D71C, 0x1D755, 'bold-italic'],
    [0x1D7CE, 0x1D7D7, 'bold'], // digits
  ];

  function unicodeBoldStyle(text) {
    const styles = [...text].map((ch) => {
      const code = ch.codePointAt(0);
      return UNICODE_BOLD.find(([from, to]) => code >= from && code <= to)?.[2];
    });
    return styles.length > 0 && styles.every((style) => style && style === styles[0]) ? styles[0] : null;
  }

  // XML only predefines &lt; &gt; &amp; &quot; &apos;. MathLive emits HTML
  // entities such as &ne; and &nbsp;, which make XML documents invalid, so
  // they become numeric references (&#8800;) on export and before import.
  const XML_ENTITIES = new Set(['lt', 'gt', 'amp', 'quot', 'apos']);
  const entityDecoder = document.createElement('textarea');

  function toNumericEntities(markup) {
    return markup.replace(/&([A-Za-z][A-Za-z0-9]*);/g, (entity, name) => {
      if (XML_ENTITIES.has(name)) return entity;
      entityDecoder.innerHTML = entity;
      const text = entityDecoder.value;
      if (text === entity) return entity; // not an HTML entity either
      return [...text].map((ch) => `&#${ch.codePointAt(0)};`).join('');
    });
  }

  function getMathML() {
    return toNumericEntities(serializeMathML());
  }

  function serializeMathML() {
    // From the LaTeX, not getValue('math-ml'): the live field leaves out styles applied with
    // applyStyle (Cmd+I's \mathrm) until the expression is parsed again
    let marked = mathField.getValue('latex');
    for (const [pattern, replacement] of EXPORT_REWRITES) marked = marked.replace(pattern, replacement);
    for (const { command, wrap: [before, after], keep } of MARKED_COMMANDS) {
      let from = 0;
      let start;
      while ((start = marked.indexOf(`${command}{`, from)) !== -1) {
        const open = start + command.length;
        const close = findClosingBrace(marked, open);
        if (close === -1) break;
        const body = keep ? marked.slice(start, close + 1) : marked.slice(open + 1, close);
        // The extra braces in `before` stop MathLive from reading a leading \frac's
        // numerator and denominator as the under/over scripts
        marked = `${marked.slice(0, start)}${before}${body}${after}${marked.slice(close + 1)}`;
        // Keep scanning inside the argument, so nested commands are marked too
        from = start + before.length + (keep ? command.length + 1 : 0);
      }
    }

    // MathLive emits HTML entities such as &nbsp;, so parse as HTML, not XML
    const doc = new DOMParser().parseFromString(
      `<math>${MathLive.convertLatexToMathMl(marked)}</math>`,
      'text/html'
    );
    const math = doc.querySelector('math');
    const operator = (text) => {
      const mo = doc.createElementNS(MATHML_NS, 'mo');
      mo.textContent = text;
      return mo;
    };
    for (const marker of math.querySelectorAll('munder > mtext:last-child, mover > mtext:last-child, mover > mtext:first-child')) {
      const wrapper = marker.parentElement;
      const name = marker.textContent;
      if (VARIANT_MARKERS[name]) {
        const base = wrapper.firstElementChild;
        markVariant(base, VARIANT_MARKERS[name]);
        wrapper.replaceWith(base);
      } else if (STRETCHY_MARKERS[name]) {
        const stretchy = operator(STRETCHY_MARKERS[name]);
        stretchy.setAttribute('stretchy', 'true');
        if (/line|Arrow$/.test(name) && marker !== wrapper.firstElementChild) {
          // Lines and arrows are accents, the form KaTeX emits
          wrapper.setAttribute(wrapper.localName === 'munder' ? 'accentunder' : 'accent', 'true');
        }
        marker.replaceWith(stretchy);
        // \underbrace{a+b}_{n}: the label goes under the brace, not beside it
        const parent = wrapper.parentElement;
        if (/brace$/.test(name) && parent?.firstElementChild === wrapper && /^ms(ub|up)$/.test(parent.localName)) {
          const stacked = doc.createElementNS(MATHML_NS, parent.localName === 'msub' ? 'munder' : 'mover');
          stacked.append(...parent.childNodes);
          parent.replaceWith(stacked);
        }
      } else if (name in PHANTOM_MARKERS) {
        const phantom = doc.createElementNS(MATHML_NS, 'mphantom');
        // \phantom{} has no base
        const content = wrapper.firstElementChild === marker ? [] : [wrapper.firstElementChild];
        if (PHANTOM_MARKERS[name]) {
          const padded = doc.createElementNS(MATHML_NS, 'mpadded');
          for (const [attribute, value] of Object.entries(PHANTOM_MARKERS[name])) padded.setAttribute(attribute, value);
          padded.append(...content);
          phantom.append(padded);
        } else {
          phantom.append(...content);
        }
        wrapper.replaceWith(phantom);
      }
    }
    repairMathML(math, operator);
    return math.innerHTML;
  }

  const INVISIBLE_OPERATORS = new Set(['\u2061', '\u2062', '\u2063', '\u2064']);
  // Elements with a fixed number of children, and that number
  const ARITY = { mfrac: 2, mroot: 2, msub: 2, msup: 2, msubsup: 3, munder: 2, mover: 2, munderover: 3 };
  const isInvisible = (el) => el?.localName === 'mo' && INVISIBLE_OPERATORS.has(el.textContent);

  // Fixes MathLive's serializer output that is invalid or means something else
  function repairMathML(math, operator) {
    // 1{,}000 is one number
    for (const comma of [...math.querySelectorAll('mtext')].filter((t) => t.textContent === COMMA_MARKER)) {
      const before = comma.previousElementSibling;
      const after = comma.nextElementSibling;
      if (before?.localName === 'mn' && after?.localName === 'mn') {
        before.textContent += `,${after.textContent}`;
        after.remove();
        comma.remove();
      } else {
        comma.replaceWith(operator(','));
      }
    }
    // Invisible operators inside scripts and fractions (f'' gets f, U+2061, primes), and
    // function application after a single letter that isn't applied to anything (g=9.8)
    for (const mo of [...math.querySelectorAll('mo')].filter(isInvisible)) {
      const parent = mo.parentElement;
      const previous = mo.previousElementSibling;
      const next = mo.nextElementSibling;
      const strayApplication = mo.textContent === '\u2061' && previous?.localName === 'mi' &&
        previous.textContent.length === 1 && !/^[([{]/.test(next?.firstElementChild?.textContent ?? next?.textContent ?? '');
      if (ARITY[parent.localName] || strayApplication) mo.remove();
    }
    // Scripts with no base ({}^{14}C, {}_nC_r) get an empty one
    for (const [name, count] of Object.entries(ARITY)) {
      for (const el of math.querySelectorAll(name)) {
        if (el.children.length === count - 1) el.prepend(el.ownerDocument.createElementNS(MATHML_NS, 'mrow'));
      }
    }
    // \binom writes a table with no cells (<mtr><mi>n</mi></mtr>); MathML's binomial is a
    // fraction with no line. Other tables get their missing cells.
    for (const table of math.querySelectorAll('mtable')) {
      const rows = [...table.children];
      if (!rows.some((row) => [...row.children].some((c) => c.localName !== 'mtd'))) continue;
      if (rows.length === 2 && rows.every((row) => row.children.length === 1)) {
        const fraction = table.ownerDocument.createElementNS(MATHML_NS, 'mfrac');
        fraction.setAttribute('linethickness', '0');
        fraction.append(...rows.map((row) => row.firstElementChild));
        table.replaceWith(fraction);
        continue;
      }
      for (const row of rows) {
        for (const cell of [...row.children].filter((c) => c.localName !== 'mtd')) {
          const mtd = row.ownerDocument.createElementNS(MATHML_NS, 'mtd');
          cell.replaceWith(mtd);
          mtd.append(cell);
        }
      }
    }
    // \mathring writes its accent as a decimal code point (<mo>730</mo>)
    for (const mo of math.querySelectorAll('mover > mo:last-child')) {
      if (/^\d{3,}$/.test(mo.textContent)) mo.textContent = String.fromCodePoint(Number(mo.textContent));
    }
    // \left\| writes its fence as LaTeX source (<mo>\|</mo>)
    for (const mo of math.querySelectorAll('mo')) {
      const fence = { '\\|': '\u2016', '\\{': '{', '\\}': '}' }[mo.textContent];
      if (fence) mo.textContent = fence;
    }
    // | and \| are written as identifiers (<mi>∣</mi>, with invisible times around them)
    for (const mi of math.querySelectorAll('mi')) {
      const bar = { '\u2223': '|', '\u2225': '\u2016' }[mi.textContent];
      if (!bar) continue;
      if (isInvisible(mi.previousElementSibling)) mi.previousElementSibling.remove();
      if (isInvisible(mi.nextElementSibling)) mi.nextElementSibling.remove();
      mi.replaceWith(operator(bar));
    }
  }

  // Bold or script letters, digits and text (operators stay as they are, like in LaTeX).
  // MathLive already writes \bm{x} as 𝐱, which needs no attribute.
  function markVariant(element, variant) {
    const tokens = element.matches('mi, mn, mtext') ? [element] : element.querySelectorAll('mi, mn, mtext');
    for (const token of tokens) {
      if (!token.hasAttribute('mathvariant') && !unicodeBoldStyle(token.textContent)) {
        token.setAttribute('mathvariant', variant);
      }
    }
  }

  // --- Namespace prefix ---

  function isValidXmlPrefix(p) {
    return /^[a-zA-Z][a-zA-Z0-9]*$/.test(p) && !/^xml$/i.test(p);
  }

  function applyNamespacePrefix(innerMathml, prefix) {
    if (!prefix) {
      return `<math xmlns="http://www.w3.org/1998/Math/MathML">${innerMathml}</math>`;
    }
    const p = prefix.endsWith(':') ? prefix.slice(0, -1) : prefix;
    if (!isValidXmlPrefix(p)) {
      return `<math xmlns="http://www.w3.org/1998/Math/MathML">${innerMathml}</math>`;
    }
    const prefixed = innerMathml.replace(/<(\/?)(m)([a-z])/g, `<$1${p}:$2$3`);
    return `<${p}:math xmlns:${p}="http://www.w3.org/1998/Math/MathML">${prefixed}</${p}:math>`;
  }

  nsPrefix.addEventListener('input', () => {
    const p = nsPrefix.value.trim();
    if (p) {
      const clean = p.endsWith(':') ? p.slice(0, -1) : p;
      nsExample.textContent = `<${clean}:math>`;
    } else {
      nsExample.textContent = '<math>';
    }
  });

  // --- Import ---

  importToggle.addEventListener('mousedown', (e) => e.preventDefault());

  importToggle.addEventListener('click', () => {
    importSection.classList.toggle('open');
    importToggle.textContent = importSection.classList.contains('open') ? 'Close' : 'Import';
    if (importSection.classList.contains('open')) refreshEngines();
    syncWindowSize();
  });

  function detectFormat(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('<')) return 'mathml';
    return 'latex';
  }

  importInput.addEventListener('input', () => {
    const text = importInput.value.trim();
    if (!text) {
      setImportHint('Auto-detects format');
      importBtn.disabled = true;
      return;
    }
    const fmt = detectFormat(text);
    setImportHint(fmt === 'mathml' ? 'Detected: MathML' : 'Detected: LaTeX');
    importBtn.disabled = false;
  });

  importBtn.addEventListener('click', () => {
    const text = importInput.value.trim();
    if (!text) return;

    const fmt = detectFormat(text);
    if (fmt === 'latex') {
      mathField.setValue(text);
    } else {
      // Auto-detect and set namespace prefix
      const detectedPrefix = detectNsPrefix(text);
      if (detectedPrefix) {
        nsPrefix.value = detectedPrefix;
        nsExample.textContent = `<${detectedPrefix}:math>`;
      }

      const latex = mathmlToLatex(text);
      if (latex === null) {
        showImportError('Invalid MathML — could not parse');
        return;
      }
      mathField.setValue(latex);
    }

    finishImport();
  });

  let importHintTimer = null;

  function setImportHint(text, state = '') {
    clearTimeout(importHintTimer);
    importHint.textContent = text;
    importHint.className = `import-hint ${state}`.trim();
    syncWindowSize();
  }

  function showImportError(message) {
    setImportHint(message, 'error');
    importHintTimer = setTimeout(() => setImportHint('Auto-detects format'), 5000);
  }

  function openImport() {
    if (!importSection.classList.contains('open')) refreshEngines();
    importSection.classList.add('open');
    importToggle.textContent = 'Close';
    syncWindowSize();
  }

  function finishImport() {
    latexPreview.textContent = mathField.getValue('latex');
    importInput.value = '';
    setImportHint('Auto-detects format');
    importBtn.disabled = true;
    importSection.classList.remove('open');
    importToggle.textContent = 'Import';
    syncWindowSize();
    mathField.focus();
    // Show the start of a long expression rather than its end
    mathField.executeCommand('moveToMathfieldStart');
  }

  // --- Images (read by Apple Intelligence or Ollama in the main process) ---

  const readingText = document.getElementById('readingText');
  let readingTimer = null;

  // Main sends this once the image is chosen, so not while the file dialog is open
  function recognitionStarted() {
    imageBtn.disabled = true;
    editorContainer.classList.add('reading');
    const started = Date.now();
    readingText.textContent = 'Reading the image…';
    clearInterval(readingTimer);
    readingTimer = setInterval(() => {
      readingText.textContent = `Reading the image… ${Math.round((Date.now() - started) / 1000)}s`;
    }, 1000);
  }

  function recognitionFinished(result) {
    // Another image arrived while one was being read; that one keeps going
    if (result.busy) {
      openImport();
      showImportError(result.error);
      return;
    }
    clearInterval(readingTimer);
    editorContainer.classList.remove('reading');
    imageBtn.disabled = false;
    if (result.latex) {
      mathField.setValue(result.latex);
      finishImport();
    } else if (result.error) {
      openImport();
      showImportError(result.error);
    }
  }

  async function recognize(request) {
    let result;
    try {
      result = await request();
    } catch {
      result = { error: 'Couldn\'t read the image.' };
    }
    recognitionFinished(result);
  }

  // Apple Intelligence and the Ollama vision models installed right now
  async function refreshEngines() {
    if (!window.electronAPI?.imageEngines) return;
    const { engines, selected, setup, recommended } = await window.electronAPI.imageEngines();
    engineSelect.replaceChildren(...engines.map((engine) => {
      const option = new Option(engine.label, engine.id);
      option.disabled = Boolean(engine.disabled);
      if (engine.title) option.title = engine.title;
      return option;
    }));
    engineSelect.value = selected;
    if (!downloading) showSetupStep(setup, recommended);
  }

  // --- Ollama setup: one step at a time, offered when nothing on this Mac can read images yet ---

  const SETUP_STEPS = {
    missing: { text: 'Read images on this Mac with Ollama, a free app for local AI models.', button: 'Get Ollama…' },
    stopped: { text: 'Ollama is installed but not running.', button: 'Start Ollama' },
    'no-model': { text: (model) => `Download the recommended model, ${model.name} (${model.download}).`, button: 'Download' }
  };
  let setupStep = null;
  let downloading = false;

  function showSetupStep(step, recommended) {
    setupStep = step;
    setupRow.hidden = !step;
    if (step) {
      const { text, button } = SETUP_STEPS[step];
      setupText.textContent = typeof text === 'function' ? text(recommended) : text;
      setupText.className = 'import-hint';
      setupBtn.textContent = button;
      setupBtn.disabled = false;
    }
    syncWindowSize();
  }

  setupBtn.addEventListener('mousedown', (e) => e.preventDefault());
  setupBtn.addEventListener('click', async () => {
    const step = setupStep;
    setupBtn.disabled = true;
    if (step === 'stopped') setupText.textContent = 'Starting Ollama…';
    if (step === 'no-model') {
      downloading = true;
      setupText.textContent = 'Downloading… 0%';
    }
    const error = await window.electronAPI.ollamaSetup(step);
    downloading = false;
    if (error) {
      setupText.textContent = error;
      setupText.className = 'import-hint error';
      setupBtn.disabled = false;
      return;
    }
    // After the download page opens, the user installs Ollama and reopens Import
    if (step !== 'missing') await refreshEngines();
    else setupBtn.disabled = false;
  });

  window.electronAPI?.onOllamaDownloadProgress?.((progress) => {
    setupText.textContent = `Downloading… ${Math.floor(progress * 100)}%`;
  });

  engineSelect.addEventListener('change', () => {
    window.electronAPI?.setImageEngine(engineSelect.value);
  });

  imageBtn.addEventListener('mousedown', (e) => e.preventDefault());
  imageBtn.addEventListener('click', () => recognize(window.electronAPI.recognizeImageFile));

  const IMAGE_NAME = /\.(png|jpe?g|heic|heif|tiff?|gif|bmp|webp)$/i;

  // Pasting an image (in the editor or the import box) reads it instead of inserting nothing.
  // Capture phase, so MathLive's own paste handler doesn't see it first.
  window.addEventListener('paste', (e) => {
    const data = e.clipboardData;
    if (!data || imageBtn.disabled || !window.electronAPI?.recognizeClipboardImage) return;
    const hasImage = [...data.items].some((item) => item.kind === 'file' && item.type.startsWith('image/'));
    const text = data.getData('text/plain').trim();
    // A file copied in Finder: the text is its name, or the list has its file URL
    const copiedFile = IMAGE_NAME.test(text) ||
      data.getData('text/uri-list').split(/\r?\n/).some((uri) => uri.startsWith('file:') && IMAGE_NAME.test(uri.trim()));
    // Copies from Word and similar apps carry a picture of the text too: paste the text
    if (!copiedFile && !(hasImage && !text)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    recognize(window.electronAPI.recognizeClipboardImage);
  }, true);

  window.electronAPI?.onRecognitionStarted?.(recognitionStarted);
  window.electronAPI?.onRecognitionResult?.(recognitionFinished);

  // --- MathML preprocessing ---

  function detectNsPrefix(mathml) {
    const match = mathml.match(/<(\w+):m(?:ath|row|i|o|n|frac|s)[\s>\/]/);
    return match ? match[1] : '';
  }

  function stripNamespaces(mathml) {
    // Remove namespace prefixes from elements: <m:math> → <math>
    let stripped = mathml.replace(/<(\/?)[\w]+:/g, '<$1');
    // Remove xmlns declarations
    stripped = stripped.replace(/\s+xmlns(?::[\w]+)?="[^"]*"/g, '');
    return stripped;
  }

  // --- MathML to LaTeX converter ---

  function mathmlToLatex(mathmlString) {
    const clean = stripNamespaces(toNumericEntities(mathmlString));
    const parser = new DOMParser();

    // Try parsing as-is
    let doc = parser.parseFromString(clean, 'text/xml');

    if (doc.querySelector('parsererror')) {
      // Try wrapping in <math> if bare MathML content was pasted
      const wrapped = `<math xmlns="http://www.w3.org/1998/Math/MathML">${clean}</math>`;
      doc = parser.parseFromString(wrapped, 'text/xml');
      if (doc.querySelector('parsererror')) return null;
    }

    return convertNode(doc.documentElement).trim();
  }

  function convertNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      // MathLive writes \ (a normal space) as a bare &nbsp;
      if (/^ +$/.test(node.textContent)) return '\\ ';
      const text = node.textContent.trim();
      return text ? tokenToLatex(text) : '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.localName;
    // Child elements, without invisible operators (MathLive puts one inside f''s <msup>)
    const elements = Array.from(node.children).filter((el) => !isInvisible(el));
    const childAt = (i) => (elements[i] ? convertNode(elements[i]) : '');
    // A script needs something to attach to: {}^{14}C
    const baseAt = (i) => childAt(i) || '{}';

    switch (tag) {
      case 'math':
      case 'mrow':
      case 'mstyle':
      case 'mtd':
        return rowLatex(node);

      case 'mphantom':
        return phantomLatex(node);

      case 'mpadded':
        // The size of a phantom can also be set from outside: <mpadded width="0"><mphantom>
        return elements.length === 1 && elements[0].localName === 'mphantom'
          ? phantomLatex(elements[0], node)
          : rowLatex(node);

      case 'mi':
      case 'mn':
      case 'mo':
        return tokenElementToLatex(node);

      case 'mtext': {
        // Characters LaTeX reads as syntax, even in text
        const text = node.textContent.replace(/[{}$%#&_]/g, '\\$&').replace(/\\(?![{}$%#&_])/g, '\\textbackslash ');
        return isBold(mathvariantOf(node)) ? `\\textbf{${text}}` : `\\text{${text}}`;
      }

      case 'mspace':
        return spaceToLatex(node.getAttribute('width'));

      case 'mfrac':
        return node.getAttribute('linethickness') === '0'
          ? `\\genfrac{}{}{0pt}{}{${childAt(0)}}{${childAt(1)}}`
          : `\\frac{${childAt(0)}}{${childAt(1)}}`;

      case 'msqrt':
        return `\\sqrt{${rowLatex(node)}}`;

      case 'mroot':
        return `\\sqrt[${childAt(1)}]{${childAt(0)}}`;

      case 'msup': {
        const script = childAt(1);
        // f′ and f″ are primes, not a superscript
        return /^'+$/.test(script) ? `${baseAt(0)}${script}` : `${baseAt(0)}^{${script}}`;
      }

      case 'msub':
        return `${baseAt(0)}_{${childAt(1)}}`;

      case 'msubsup':
        return `${baseAt(0)}_{${childAt(1)}}^{${childAt(2)}}`;

      case 'munder': {
        const [baseEl, underEl] = elements;
        const base = childAt(0);
        const underText = underEl?.textContent.trim() ?? '';
        if (underText === '‾' || underText === '̲' || underText === '_')
          return `\\underline{${base}}`;
        if (underText === '⏟') return `\\underbrace{${base}}`;
        // Limits, big operators and braces take a subscript: \lim_{x\to0}, not \underset{x\to0}{\lim}
        if (/^\\(lim|max|min|sup|inf|sum|prod|coprod|bigcup|bigcap|bigoplus|bigotimes|bigvee|bigwedge)\s*$/.test(base) ||
          isStretched(baseEl, 'munder', '⏟'))
          return `${base.trim()}_{${childAt(1)}}`;
        return `\\underset{${childAt(1)}}{${base}}`;
      }

      case 'mover':
        return overLatex(elements, childAt);

      case 'munderover': {
        const arrow = { '→': '\\xrightarrow', '←': '\\xleftarrow' }[elements[0]?.textContent.trim()];
        if (arrow && elements[0].localName === 'mo') return `${arrow}[${childAt(1)}]{${childAt(2)}}`;
        return `${childAt(0)}_{${childAt(1)}}^{${childAt(2)}}`;
      }

      case 'mmultiscripts':
        return multiscriptsLatex(node);

      case 'mtable':
        return tableLatex(node, 'matrix');

      case 'mfenced': {
        const open = node.getAttribute('open') ?? '(';
        const close = node.getAttribute('close') ?? ')';
        if (elements.length === 1 && elements[0].localName === 'mtable') {
          const environment = FENCE_ENVIRONMENTS[open]?.[0] ?? 'matrix';
          return tableLatex(elements[0], environment === 'Bmatrix' && !close ? 'cases' : environment);
        }
        // Children are separated by commas unless separators says otherwise
        const separators = [...(node.getAttribute('separators') ?? ',').replace(/\s/g, '')];
        const inner = elements.map((el, i) => {
          const separator = i ? separators[Math.min(i - 1, separators.length - 1)] ?? '' : '';
          return tokenToLatex(separator) + convertNode(el);
        }).join('');
        return `\\left${fenceLatex(open)}${inner}\\right${fenceLatex(close)}`;
      }

      default:
        return rowLatex(node);
    }
  }

  // The children of a row. A table between fences is a matrix environment: ( ) pmatrix,
  // [ ] bmatrix, | | vmatrix, { } Bmatrix, and { alone cases. A fraction with no line in
  // parentheses is \binom.
  function rowLatex(node) {
    const nodes = [...node.childNodes].filter((n) =>
      n.nodeType === Node.ELEMENT_NODE ? !isInvisible(n) : /\S| /.test(n.textContent));
    let out = '';
    for (let i = 0; i < nodes.length; i++) {
      const fenced = fencedLatex(nodes, i);
      if (fenced) {
        out += fenced.latex;
        i += fenced.length - 1;
      } else {
        const piece = convertNode(nodes[i]);
        // \quad b, not \quadb
        out += /\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z]/.test(piece) ? ` ${piece}` : piece;
      }
    }
    return out;
  }

  const FENCE_ENVIRONMENTS = {
    '(': ['pmatrix', ')'],
    '[': ['bmatrix', ']'],
    '{': ['Bmatrix', '}'],
    '|': ['vmatrix', '|'],
    '∣': ['vmatrix', '∣'],
    '‖': ['Vmatrix', '‖'],
    '∥': ['Vmatrix', '∥'],
  };

  function fencedLatex(nodes, i) {
    const [open, inner, close] = nodes.slice(i, i + 3);
    if (open?.localName !== 'mo' || !inner) return null;
    const fence = FENCE_ENVIRONMENTS[open.textContent.trim()];
    if (!fence) return null;
    const [environment, closeText] = fence;
    const closed = close?.localName === 'mo' && close.textContent.trim() === closeText;
    if (inner.localName === 'mfrac' && inner.getAttribute('linethickness') === '0' && environment === 'pmatrix' && closed) {
      const [top = '', bottom = ''] = [...inner.children].filter((el) => !isInvisible(el)).map(convertNode);
      return { latex: `\\binom{${top}}{${bottom}}`, length: 3 };
    }
    if (inner.localName !== 'mtable') return null;
    if (closed) return { latex: tableLatex(inner, environment), length: 3 };
    return environment === 'Bmatrix' ? { latex: tableLatex(inner, 'cases'), length: 2 } : null;
  }

  // <mmultiscripts>: base, then subscript/superscript pairs after it, then <mprescripts/> and
  // the pairs before it, such as an isotope: {}_{92}^{235}U
  function multiscriptsLatex(node) {
    const [base, ...rest] = [...node.children].filter((el) => !isInvisible(el));
    const split = rest.findIndex((el) => el.localName === 'mprescripts');
    const post = split < 0 ? rest : rest.slice(0, split);
    const pre = split < 0 ? [] : rest.slice(split + 1);
    const scripts = (elements) => {
      let latex = '';
      for (let i = 0; i < elements.length; i += 2) {
        // An empty slot is <none/>, or a phantom copy of the other script for Word
        const [sub, sup] = [elements[i], elements[i + 1]].map((el) => (el && !['none', 'mphantom'].includes(el.localName) ? convertNode(el) : ''));
        if (sub) latex += `_{${sub}}`;
        if (sup) latex += `^{${sup}}`;
      }
      return latex;
    };
    const before = scripts(pre);
    return `${before ? `{}${before}` : ''}${base ? convertNode(base) : ''}${scripts(post)}`;
  }

  // <mphantom> is \phantom. An <mpadded> with no height and depth inside it (or around it) makes
  // it \hphantom, and one with no width \vphantom.
  function phantomLatex(phantom, outer = null) {
    const elements = [...phantom.children].filter((el) => !isInvisible(el));
    const inner = elements.length === 1 && elements[0].localName === 'mpadded' ? elements[0] : null;
    const content = rowLatex(inner ?? phantom);
    const padded = outer ?? inner;
    const zero = (attribute) => padded?.hasAttribute(attribute) && parseFloat(padded.getAttribute(attribute)) === 0;
    if (zero('height') && zero('depth') && !zero('width')) return `\\hphantom{${content}}`;
    if (zero('width') && !zero('height') && !zero('depth')) return `\\vphantom{${content}}`;
    return `\\phantom{${content}}`;
  }

  function tableLatex(table, environment) {
    const rows = [...table.children]
      .filter((row) => row.localName === 'mtr' || row.localName === 'mlabeledtr')
      .map((row) => [...row.children].map(convertNode).join('&'));
    return `\\begin{${environment}}${rows.join('\\\\')}\\end{${environment}}`;
  }

  function fenceLatex(fence) {
    if (!fence) return '.';
    const commands = {
      '{': '\\{', '}': '\\}', '‖': '\\|', '∥': '\\|', '∣': '|', '⟨': '\\langle ', '⟩': '\\rangle ',
    };
    return commands[fence] ?? fence;
  }

  // An element drawn with a stretched mark under or over it: <munder>…<mo>⏟</mo></munder>
  function isStretched(element, tag, mark) {
    return element?.localName === tag && element.lastElementChild?.textContent.trim() === mark;
  }

  // MathML space widths in em, and the LaTeX space for each
  const SPACES = [[-1 / 6, '\\!'], [0, ''], [1 / 6, '\\,'], [2 / 9, '\\:'], [5 / 18, '\\;'], [1, '\\quad'], [2, '\\qquad']];
  // MathML 2 named spaces, in eighteenths of an em
  const NAMED_SPACES = {
    veryverythinmathspace: 1, verythinmathspace: 2, thinmathspace: 3, mediummathspace: 4,
    thickmathspace: 5, verythickmathspace: 6, veryverythickmathspace: 7,
  };
  const SPACE_UNITS = { em: 1, ex: 0.5, mu: 1 / 18, pt: 0.1, px: 1 / 16 };

  // The LaTeX space closest to an <mspace> width (\, for 0.1667em, \quad for 1em)
  function spaceToLatex(width) {
    if (!width) return '';
    const negative = width.startsWith('negative');
    let em;
    if (NAMED_SPACES[width.replace(/^negative/, '')]) {
      em = (negative ? -1 : 1) * NAMED_SPACES[width.replace(/^negative/, '')] / 18;
    } else {
      const match = width.trim().match(/^(-?[\d.]+)\s*([a-z]*)$/);
      if (!match) return '\;';
      em = parseFloat(match[1]) * (SPACE_UNITS[match[2] || 'em'] ?? 1);
    }
    return SPACES.reduce((best, space) => (Math.abs(space[0] - em) < Math.abs(best[0] - em) ? space : best))[1];
  }

  // Accents, as the <mo> text MathLive writes -> LaTeX command, read from MathLive itself so an
  // import gives back what export wrote. ACCENT_ALIASES covers what other tools write.
  const ACCENT_COMMANDS = ['hat', 'bar', 'dot', 'ddot', 'check', 'breve', 'acute', 'grave', 'tilde', 'vec', 'mathring'];
  const ACCENT_ALIASES = {
    '^': '\\hat', '̂': '\\hat', 'ˆ': '\\hat', '̄': '\\bar', '~': '\\tilde', '̃': '\\tilde',
    '̇': '\\dot', '.': '\\dot', '̈': '\\ddot', '→': '\\vec', '˚': '\\mathring',
  };
  let accentCommands = null;

  function accentCommand(text) {
    if (!accentCommands) {
      accentCommands = new Map();
      for (const name of ACCENT_COMMANDS) {
        const match = MathLive.convertLatexToMathMl(`\\${name}{x}`).match(/<mo>([^<]+)<\/mo><\/mover>$/);
        const char = match && decodeEntities(match[1]);
        if (char && !accentCommands.has(char)) accentCommands.set(char, `\\${name}`);
      }
    }
    return accentCommands.get(text) ?? ACCENT_ALIASES[text];
  }

  // <mover>: an accent, a line, arrow or brace over its base, or \xrightarrow's label
  function overLatex(elements, childAt) {
    const [baseEl, overEl] = elements;
    const base = childAt(0);
    const overText = overEl?.textContent.trim() ?? '';
    // A line or arrow over more than one character stretches: \overline{AB}, \overrightarrow{AB}
    const wide = overEl?.getAttribute('stretchy') === 'true' ||
      !(baseEl?.matches('mi, mn, mo') && [...baseEl.textContent.trim()].length === 1);
    const arrow = { '→': '\\xrightarrow', '←': '\\xleftarrow' }[baseEl?.textContent.trim()];
    if (arrow && baseEl.localName === 'mo') return `${arrow}{${childAt(1)}}`;
    if (overText === '‾' || (wide && (overText === '¯' || overText === '̅')))
      return `\\overline{${base}}`;
    if (overText === '⏞') return `\\overbrace{${base}}`;
    if (overText === '←') return `\\overleftarrow{${base}}`;
    if (wide && (overText === '→' || overText === '⃗')) return `\\overrightarrow{${base}}`;
    if (isStretched(baseEl, 'mover', '⏞')) return `${base}^{${childAt(1)}}`;
    const accent = accentCommand(overText);
    return accent ? `${accent}{${base}}` : `\\overset{${childAt(1)}}{${base}}`;
  }

  function decodeEntities(html) {
    return new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html').body.textContent;
  }

  // Characters LaTeX reads as syntax, and characters with no command of their own
  const MO_MAP = {
    '−': '-',
    '{': '\\{',
    '}': '\\}',
    '%': '\\%',
    '$': '\\$',
    '#': '\\#',
    '&': '\\&',
    '_': '\\_',
    '\\': '\\backslash',
    '′': "'",
    '″': "''",
    '‴': "'''",
    '‖': '\\|',
    '∣': '\\mid',
    // Invisible operators: function application, times, separator, plus
    '⁡': '',
    '⁢': '',
    '⁣': '',
    '⁤': '',
  };

  // Commands for symbols and Greek letters. Their characters are read from MathLive itself, so
  // an import gives back what export wrote. When two commands make the same character, the
  // first one wins (\to over \rightarrow, \leq over \le).
  const SYMBOL_COMMANDS = `
    alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi
    pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega
    Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega
    pm mp times div cdot ast star circ bullet oplus ominus otimes oslash odot cap cup sqcap sqcup
    land lor wedge vee neg setminus wr uplus amalg dagger ddagger
    leq geq neq approx equiv sim simeq cong propto ll gg prec succ preceq succeq
    subset supset subseteq supseteq sqsubseteq sqsupseteq in notin ni mid parallel perp models
    vdash dashv asymp doteq
    to rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow Longrightarrow
    Longleftarrow Longleftrightarrow longrightarrow longleftarrow mapsto uparrow downarrow
    updownarrow Uparrow Downarrow nearrow searrow swarrow nwarrow hookrightarrow hookleftarrow
    infty forall exists nexists emptyset nabla partial aleph hbar ell wp Re Im angle triangle
    therefore because ldots cdots vdots ddots prime degree top bot surd
    sum prod coprod int iint iiint oint bigcup bigcap bigoplus bigotimes bigvee bigwedge
    langle rangle lfloor rfloor lceil rceil`.trim().split(/\s+/);
  let symbolCommands = null;

  function symbolCommand(text) {
    if (!symbolCommands) {
      symbolCommands = new Map();
      for (const name of SYMBOL_COMMANDS) {
        const match = MathLive.convertLatexToMathMl(`\\${name}`).match(/^<m[io][^>]*>([^<]+)<\/m[io]>$/);
        const char = match && decodeEntities(match[1]);
        if (char && !symbolCommands.has(char)) symbolCommands.set(char, `\\${name}`);
      }
    }
    return symbolCommands.get(text);
  }

  // Named functions MathML writes as <mi>sin</mi> (or <mo>lim</mo>)
  const FUNCTION_NAMES = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
    'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'lim', 'max',
    'min', 'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'gcd', 'arg', 'hom', 'Pr',
  ]);

  // Text of an <mi> or <mo> as LaTeX: a function name, a character LaTeX reads as syntax, or a
  // symbol or Greek letter with a command. A command gets a trailing space so it can't run into
  // a following letter (\sin x and a\times b, not \sinx and a\timesb).
  function tokenToLatex(text) {
    if (/^\u2032+$/.test(text)) return "'".repeat(text.length);
    const latex = FUNCTION_NAMES.has(text) ? `\\${text}` : MO_MAP[text] ?? symbolCommand(text) ?? text;
    return /\\[a-zA-Z]+$/.test(latex) ? `${latex} ` : latex;
  }

  // Font variants other than bold, as LaTeX commands for Latin letters and digits
  const VARIANT_COMMANDS = {
    normal: '\\mathrm', 'double-struck': '\\mathbb', script: '\\mathcal', fraktur: '\\mathfrak',
    'sans-serif': '\\mathsf', monospace: '\\mathtt',
  };
  // Mathematical Alphanumeric Symbols for other fonts (MathLive writes \mathbb{R} as ℝ),
  // as code point ranges, plus the older letterlike symbols such as ℝ and ℭ
  const UNICODE_VARIANTS = [
    [0x1D49C, 0x1D4CF, '\\mathcal'], [0x1D504, 0x1D537, '\\mathfrak'], [0x1D538, 0x1D56B, '\\mathbb'],
    [0x1D5A0, 0x1D5D3, '\\mathsf'], [0x1D670, 0x1D6A3, '\\mathtt'], [0x1D7D8, 0x1D7E1, '\\mathbb'],
    [0x1D7E2, 0x1D7EB, '\\mathsf'], [0x1D7F6, 0x1D7FF, '\\mathtt'],
  ];
  const LETTERLIKE_VARIANTS = {
    '\\mathbb': 'ℂℍℕℙℚℝℤ', '\\mathfrak': 'ℭℌℑℜℨ', '\\mathcal': 'ℬℰℱℋℐℒℳℛ',
  };

  // \mathbb{R} for ℝ or 𝕉, null for anything else
  function unicodeVariantLatex(text) {
    const chars = [...text];
    if (chars.length !== 1) return null;
    const code = chars[0].codePointAt(0);
    const command = UNICODE_VARIANTS.find(([from, to]) => code >= from && code <= to)?.[2] ??
      Object.keys(LETTERLIKE_VARIANTS).find((c) => LETTERLIKE_VARIANTS[c].includes(chars[0]));
    return command ? `${command}{${text.normalize('NFKC')}}` : null;
  }

  // Bars written as identifiers: | and \| (MathLive's own MathML did this before 1.3.0)
  const IDENTIFIER_BARS = { '∣': '|', '∥': '\\|' };

  // <mi>, <mn> or <mo> as LaTeX, keeping bold from mathvariant, fontweight or 𝐱-style characters,
  // and other font variants (\mathrm, \mathbb, …)
  function tokenElementToLatex(node) {
    let text = node.textContent.trim();
    const unicodeBold = unicodeBoldStyle(text);
    if (unicodeBold) text = text.normalize('NFKC'); // 𝐱 → x
    if (node.localName === 'mn') {
      // 1,000 is one number; {,} keeps LaTeX from spacing it like a list
      const number = text.replace(/,/g, '{,}');
      return isBold(mathvariantOf(node) ?? unicodeBold) ? `\\mathbf{${number}}` : number;
    }
    if (node.localName === 'mi' && IDENTIFIER_BARS[text]) return IDENTIFIER_BARS[text];
    // ⊥ between two things is perpendicular (MathLive's \perp is ⟂, and ⊥ alone is \bot)
    if (node.localName === 'mo' && text === '\u22A5') return '\\perp ';
    const variantLatex = unicodeVariantLatex(text);
    if (variantLatex) return variantLatex;
    const latex = tokenToLatex(text);
    // Operators stay regular, as with \mathbf in LaTeX and on export
    const variant = node.localName === 'mo' ? null : mathvariantOf(node) ?? unicodeBold;
    const letters = /^[A-Za-z0-9]+$/.test(text);
    if (letters && VARIANT_COMMANDS[variant] && !(variant === 'normal' && node.localName !== 'mi')) {
      return `${VARIANT_COMMANDS[variant]}{${text}}`;
    }
    // Several letters in an <mi> are upright, like a function name: <mi>Var</mi>
    if (node.localName === 'mi' && !variant && /^[A-Za-z]{2,}$/.test(text) && !FUNCTION_NAMES.has(text)) {
      return `\\operatorname{${text}}`;
    }
    if (!isBold(variant)) return latex;
    // \mathbf covers Latin letters and digits; \boldsymbol also covers Greek and symbols
    const command = variant === 'bold' && /^[A-Za-z0-9.,]+$/.test(text) ? '\\mathbf' : '\\boldsymbol';
    return `${command}{${latex.trim()}}`;
  }

  // The token's own mathvariant or one inherited from an <mstyle>; MathML 2 used fontweight
  function mathvariantOf(node) {
    const variant = node.closest('[mathvariant]')?.getAttribute('mathvariant');
    if (variant) return variant;
    return node.closest('[fontweight]')?.getAttribute('fontweight') === 'bold' ? 'bold' : null;
  }

  function isBold(variant) {
    return variant === 'bold' || variant === 'bold-italic';
  }

  // Focus on load
  mathField.focus();
});
