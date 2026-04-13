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

  customElements.whenDefined('math-field').then(() => {
    installMathLiveMenuSwatchFix(mathField.shadowRoot);
  });

  mathField.setOptions({
    mathVirtualKeyboardPolicy: 'manual'
  });

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

  // --- Virtual keyboard ---

  const BASE_WIDTH = 520;
  const BASE_HEIGHT = 380;
  const kbContainer = document.getElementById('keyboardContainer');

  mathVirtualKeyboard.container = kbContainer;

  mathField.addEventListener('focusin', () => mathVirtualKeyboard.show());

  mathField.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!mathField.matches(':focus-within') && !mathField.matches(':focus')) {
        mathVirtualKeyboard.hide();
      }
    }, 150);
  });

  mathVirtualKeyboard.addEventListener('geometrychange', () => {
    const kbHeight = mathVirtualKeyboard.boundingRect.height;
    const newHeight = BASE_HEIGHT + Math.round(kbHeight) + (kbHeight > 0 ? 24 : 0);
    window.electronAPI.resizeWindow(BASE_WIDTH, newHeight);
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
    return window.electronAPI.copyText(text).catch(() => {
      return navigator.clipboard.writeText(text);
    });
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
    const inner = mathField.getValue('math-ml');
    if (inner) {
      const latex = mathField.getValue('latex');
      addToHistory(latex);
      const prefix = nsPrefix.value.trim();
      const mathml = applyNamespacePrefix(inner, prefix);
      copyToClipboard(mathml).then(() => flashCopied(copyMathMLBtn));
    }
  });

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
    const clean = stripNamespaces(mathmlString);
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
      case 'mn':
        return node.textContent.trim();

      case 'mo': {
        const op = node.textContent.trim();
        return moToLatex(op);
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

      case 'munder':
        return `\\underset{${childAt(1)}}{${childAt(0)}}`;

      case 'mover': {
        const base = childAt(0);
        const overEl = Array.from(node.children)[1];
        const overText = overEl ? overEl.textContent.trim() : '';
        if (overText === '\u0302' || overText === '^' || overText === '\u005E')
          return `\\hat{${base}}`;
        if (overText === '\u0304' || overText === '\u00AF' || overText === '\u0305')
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
  };

  function moToLatex(op) {
    return MO_MAP[op] || op;
  }

  // Focus on load
  mathField.focus();
});
