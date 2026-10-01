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

  // Cmd+B / Cmd+U: capture phase, so MathLive never sees a handled keystroke
  mathField.addEventListener('keydown', (e) => {
    if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const key = e.key.toLowerCase();
    const handled = key === 'b' ? toggleBold() : key === 'u' ? toggleUnderline() : false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  function toggleBold() {
    if (mathField.mode === 'latex') return false;
    // Math bold is a variant style (\mathbf); text bold is a font series (\textbf)
    const bold = mathField.mode === 'text' ? { fontSeries: 'b' } : { variantStyle: 'bold' };
    if (mathField.selectionIsCollapsed && bold.variantStyle && mathField.queryStyle(bold) === 'all') {
      // With no selection, applyStyle can turn variantStyle on but never off
      mathField.executeCommand(['applyStyle', { variantStyle: '' }]);
    } else {
      mathField.executeCommand(['applyStyle', bold]);
    }
    return true;
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

  // MathLive's MathML serializer silently drops \underline and \overline,
  // contents included. Rewrite them as \underset/\overset with a marker script,
  // then swap the marker for a stretchy line accent (the form KaTeX emits).
  const LINE_ACCENTS = [
    { command: '\\underline', standIn: '\\underset', element: 'munder', attribute: 'accentunder', marker: 'MacMathUnderline' },
    { command: '\\overline', standIn: '\\overset', element: 'mover', attribute: 'accent', marker: 'MacMathOverline' },
  ];

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
    const latex = mathField.getValue('latex');
    const accents = LINE_ACCENTS.filter(({ command }) => latex.includes(`${command}{`));
    if (accents.length === 0) return mathField.getValue('math-ml');

    let marked = latex;
    for (const { command, standIn, marker } of accents) {
      let start;
      while ((start = marked.indexOf(`${command}{`)) !== -1) {
        const open = start + command.length;
        const close = findClosingBrace(marked, open);
        if (close === -1) break;
        // The extra braces stop MathLive from reading a leading \frac's
        // numerator and denominator as the under/over scripts
        marked = `${marked.slice(0, start)}${standIn}{\\text{${marker}}}{{${marked.slice(open + 1, close)}}}${marked.slice(close + 1)}`;
      }
    }

    // MathLive emits HTML entities such as &nbsp;, so parse as HTML, not XML
    const doc = new DOMParser().parseFromString(
      `<math>${MathLive.convertLatexToMathMl(marked)}</math>`,
      'text/html'
    );
    const math = doc.querySelector('math');
    for (const { element, attribute, marker } of accents) {
      for (const script of math.querySelectorAll(`${element} > mtext:last-child`)) {
        if (script.textContent !== marker) continue;
        const line = doc.createElementNS('http://www.w3.org/1998/Math/MathML', 'mo');
        line.setAttribute('stretchy', 'true');
        line.textContent = '\u203E';
        script.parentElement.setAttribute(attribute, 'true');
        script.replaceWith(line);
      }
    }
    return math.innerHTML;
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
      importHint.textContent = 'Auto-detects format';
      importBtn.disabled = true;
      return;
    }
    const fmt = detectFormat(text);
    importHint.textContent = fmt === 'mathml' ? 'Detected: MathML' : 'Detected: LaTeX';
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
        importHint.textContent = 'Invalid MathML — could not parse';
        importHint.style.color = '#ff453a';
        setTimeout(() => {
          importHint.style.color = '';
          importHint.textContent = 'Auto-detects format';
        }, 3000);
        return;
      }
      mathField.setValue(latex);
    }

    latexPreview.textContent = mathField.getValue('latex');
    importInput.value = '';
    importHint.textContent = 'Auto-detects format';
    importBtn.disabled = true;
    importSection.classList.remove('open');
    importToggle.textContent = 'Import';
    syncWindowSize();
    mathField.focus();
  });

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

    return convertNode(doc.documentElement);
  }

  function convertNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.trim();
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.localName;
    const children = Array.from(node.childNodes);

    function childLatex() {
      return children.map(convertNode).join('');
    }

    function childAt(i) {
      const elements = Array.from(node.children);
      return elements[i] ? convertNode(elements[i]) : '';
    }

    switch (tag) {
      case 'math':
      case 'mrow':
      case 'mstyle':
      case 'mpadded':
        return childLatex();

      case 'mi':
        return tokenToLatex(node.textContent.trim());

      case 'mn':
        return node.textContent.trim();

      case 'mo': {
        const op = node.textContent.trim();
        return tokenToLatex(op);
      }

      case 'mtext':
        return `\\text{${node.textContent}}`;

      case 'mspace':
        return '\\;';

      case 'mfrac':
        return `\\frac{${childAt(0)}}{${childAt(1)}}`;

      case 'msqrt':
        return `\\sqrt{${childLatex()}}`;

      case 'mroot':
        return `\\sqrt[${childAt(1)}]{${childAt(0)}}`;

      case 'msup':
        return `${childAt(0)}^{${childAt(1)}}`;

      case 'msub':
        return `${childAt(0)}_{${childAt(1)}}`;

      case 'msubsup':
        return `${childAt(0)}_{${childAt(1)}}^{${childAt(2)}}`;

      case 'munder': {
        const base = childAt(0);
        const underEl = Array.from(node.children)[1];
        const underText = underEl ? underEl.textContent.trim() : '';
        if (underText === '\u203E' || underText === '\u0332' || underText === '_')
          return `\\underline{${base}}`;
        // Limits and big operators take a subscript: \lim_{x\to0}, not \underset{x\to0}{\lim}
        if (/^\\(lim|max|min|sup|inf|sum|prod)\s*$/.test(base))
          return `${base.trim()}_{${childAt(1)}}`;
        return `\\underset{${childAt(1)}}{${base}}`;
      }

      case 'mover': {
        const base = childAt(0);
        const overEl = Array.from(node.children)[1];
        const overText = overEl ? overEl.textContent.trim() : '';
        if (overText === '\u0302' || overText === '^' || overText === '\u005E')
          return `\\hat{${base}}`;
        if (overText === '\u0304' || overText === '\u00AF' || overText === '\u0305' || overText === '\u203E')
          return `\\overline{${base}}`;
        if (overText === '\u2192' || overText === '\u20D7')
          return `\\vec{${base}}`;
        if (overText === '\u02DC' || overText === '~')
          return `\\tilde{${base}}`;
        if (overText === '\u02D9' || overText === '.')
          return `\\dot{${base}}`;
        return `\\overset{${convertNode(overEl)}}{${base}}`;
      }

      case 'munderover': {
        const base = childAt(0);
        const under = childAt(1);
        const over = childAt(2);
        return `${base}_{${under}}^{${over}}`;
      }

      case 'mtable':
        return convertTable(node);

      case 'mtr':
        return Array.from(node.children)
          .map(convertNode)
          .join(' & ');

      case 'mtd':
        return childLatex();

      case 'mfenced': {
        const open = node.getAttribute('open') || '(';
        const close = node.getAttribute('close') || ')';
        return `\\left${open}${childLatex()}\\right${close}`;
      }

      default:
        return childLatex();
    }
  }

  function convertTable(node) {
    const rows = Array.from(node.children)
      .filter(c => c.localName === 'mtr')
      .map(convertNode)
      .join(' \\\\ ');
    return `\\begin{matrix} ${rows} \\end{matrix}`;
  }

  const MO_MAP = {
    '\u00B1': '\\pm',
    '\u00D7': '\\times',
    '\u00F7': '\\div',
    '\u2212': '-',
    '\u2264': '\\leq',
    '\u2265': '\\geq',
    '\u2260': '\\neq',
    '\u2248': '\\approx',
    '\u221E': '\\infty',
    '\u2208': '\\in',
    '\u2209': '\\notin',
    '\u2282': '\\subset',
    '\u2283': '\\supset',
    '\u2286': '\\subseteq',
    '\u2287': '\\supseteq',
    '\u222A': '\\cup',
    '\u2229': '\\cap',
    '\u2192': '\\to',
    '\u2190': '\\leftarrow',
    '\u21D2': '\\Rightarrow',
    '\u21D0': '\\Leftarrow',
    '\u2200': '\\forall',
    '\u2203': '\\exists',
    '\u2207': '\\nabla',
    '\u2202': '\\partial',
    '\u222B': '\\int',
    '\u222C': '\\iint',
    '\u222D': '\\iiint',
    '\u2211': '\\sum',
    '\u220F': '\\prod',
    '\u2227': '\\land',
    '\u2228': '\\lor',
    '\u00AC': '\\neg',
    '\u22C5': '\\cdot',
    '\u2026': '\\ldots',
    '\u22EF': '\\cdots',
    '\u03B1': '\\alpha',
    '\u03B2': '\\beta',
    '\u03B3': '\\gamma',
    '\u03B4': '\\delta',
    '\u03B5': '\\epsilon',
    '\u03B6': '\\zeta',
    '\u03B7': '\\eta',
    '\u03B8': '\\theta',
    '\u03B9': '\\iota',
    '\u03BA': '\\kappa',
    '\u03BB': '\\lambda',
    '\u03BC': '\\mu',
    '\u03BD': '\\nu',
    '\u03BE': '\\xi',
    '\u03C0': '\\pi',
    '\u03C1': '\\rho',
    '\u03C3': '\\sigma',
    '\u03C4': '\\tau',
    '\u03C5': '\\upsilon',
    '\u03C6': '\\phi',
    '\u03C7': '\\chi',
    '\u03C8': '\\psi',
    '\u03C9': '\\omega',
    '\u0393': '\\Gamma',
    '\u0394': '\\Delta',
    '\u0398': '\\Theta',
    '\u039B': '\\Lambda',
    '\u039E': '\\Xi',
    '\u03A0': '\\Pi',
    '\u03A3': '\\Sigma',
    '\u03A6': '\\Phi',
    '\u03A8': '\\Psi',
    '\u03A9': '\\Omega',
    // Invisible operators: function application, times, separator, plus
    '\u2061': '',
    '\u2062': '',
    '\u2063': '',
    '\u2064': '',
  };

  // Named functions MathML writes as <mi>sin</mi> (or <mo>lim</mo>)
  const FUNCTION_NAMES = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
    'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'lim', 'max',
    'min', 'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'gcd', 'arg', 'hom', 'Pr',
  ]);

  // Text of an <mi> or <mo> as LaTeX. MO_MAP also covers Greek letters in <mi>.
  // A command gets a trailing space so it can't run into a following letter
  // (\sin x and a\times b, not \sinx and a\timesb).
  function tokenToLatex(text) {
    const latex = FUNCTION_NAMES.has(text) ? `\\${text}` : MO_MAP[text] ?? text;
    return /\\[a-zA-Z]+$/.test(latex) ? `${latex} ` : latex;
  }

  // Focus on load
  mathField.focus();
});
