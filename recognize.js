// Reads math from images. Two kinds of engine:
//  - 'apple': Apple's on-device model through native/mathocr.swift (macOS 27+)
//  - 'ollama:<model>': a vision model the user installed with Ollama (http://localhost:11434)
// 'auto' picks Apple when it's available, otherwise the recommended Ollama model if it's installed,
// otherwise the first installed Ollama vision model that fits in memory.

const { app, clipboard, nativeImage } = require('electron');
const { fileURLToPath } = require('url');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'heic', 'heif', 'tif', 'tiff', 'gif', 'bmp', 'webp'];
const HELPER_TIMEOUT = 120000;
// Local models can take a while, especially the first time one loads into memory
const OLLAMA_TIMEOUT = 300000;
const OLLAMA_URL = 'http://localhost:11434';
// Best first. On 37 rendered textbook formulas qwen2.5vl:7b got all right (about 10 s each,
// 8.8 GB loaded); qwen2.5vl:3b missed 3 (about 7 s, 5.5 GB). Recommend the best that fits in memory.
const RECOMMENDED_MODELS = [
  { name: 'qwen2.5vl:7b', download: '6 GB', size: 5969245856 },
  { name: 'qwen2.5vl:3b', download: '3.2 GB', size: 3200627168 }
];
// Ollama keeps a model in memory for 5 minutes by default. Keep it only long enough that a few
// images in a row don't each reload it; MacMath also unloads it when it quits.
const KEEP_ALIVE = '30s';
// Loaded, a vision model takes about 1.7 times its file size (qwen2.5vl:3b: 3.2 GB file, 5.5 GB
// loaded). Hide models that would take more than 60% of memory and push the rest of the Mac
// into swap (a 35 GB model froze a 32 GB Mac).
const MEMORY_PER_FILE_SIZE = 1.7;
const MAX_MODEL_MEMORY_SHARE = 0.6;
const OLLAMA_APP_PATHS = ['/Applications/Ollama.app', path.join(os.homedir(), 'Applications', 'Ollama.app')];
const OLLAMA_CLI_PATHS = ['/opt/homebrew/bin/ollama', '/usr/local/bin/ollama'];
// Larger images only cost time and tokens
const MAX_IMAGE_SIDE = 1600;

// Same instructions as native/mathocr.swift. Chosen by testing prompts on rendered textbook
// formulas: rules about matrix environments made the models swap bracket types (tidyEnvironments
// handles those instead), and a rule about several lines made qwen2.5vl:7b wrap every formula in aligned.
const INSTRUCTIONS = 'You transcribe mathematics from images into LaTeX.\n' +
  'Rules:\n' +
  '- Reply with only the LaTeX. No explanation, no Markdown, no $ or $$.\n' +
  '- Write words with normal spacing inside \\text{}, for example \\text{at least one head}. Never put spaces between the letters of a word.\n' +
  '- Use \\bar{x} for a letter with a bar over it, \\hat{y} for a hat.\n' +
  '- Keep every bracket, brace and bar exactly as shown.\n' +
  '- Copy exactly what is shown. Do not solve, simplify or add anything.';
const PROMPT = 'Transcribe the math in this image as LaTeX.';

let recognizing = false;
let loadedOllamaModel = null;

function isImageFile(file) {
  return IMAGE_EXTENSIONS.includes(path.extname(file).slice(1).toLowerCase());
}

// --- Settings ---

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function getEngine() {
  return readSettings().imageEngine || 'auto';
}

function setEngine(engine) {
  if (!(engine === 'auto' || engine === 'apple' || /^ollama:./.test(engine))) return;
  const settings = { ...readSettings(), imageEngine: String(engine) };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

// --- Apple (native helper) ---

function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mathocr')
    : path.join(__dirname, 'native', 'bin', 'mathocr');
}

// Resolves with the helper's JSON reply, or { error } when it can't run
function runHelper(args) {
  const helper = helperPath();
  if (!fs.existsSync(helper)) {
    return Promise.resolve({
      available: false,
      reason: 'Apple Intelligence support isn\'t built into this copy of MacMath. It needs macOS 27; see the README.'
    });
  }
  return new Promise((resolve) => {
    execFile(helper, args, { timeout: HELPER_TIMEOUT }, (err, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ error: err?.killed ? 'Reading the image took too long.' : 'The image helper failed to run.' });
      }
    });
  });
}

// null when Apple's model can read images here, otherwise why not
async function appleUnavailableReason() {
  const status = await runHelper(['check']);
  return status.available ? null : (status.reason || status.error);
}

async function recognizeWithApple(file) {
  const result = await runHelper(['recognize', file]);
  return result.error ? { error: result.error } : { text: result.latex ?? '' };
}

// --- Ollama ---

async function ollama(endpoint, body, timeout = 3000) {
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('Ollama took too long to answer.');
    throw new Error('Ollama isn\'t running. Open the Ollama app and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ? `Ollama: ${data.error}` : `Ollama answered with HTTP ${response.status}.`);
  return data;
}

// Installed models that accept images: [{ name, fits }]. Throws when Ollama isn't running.
async function ollamaVisionModels() {
  const { models = [] } = await ollama('tags');
  models.sort((a, b) => a.name.localeCompare(b.name));
  const shown = await Promise.all(models.map((m) => ollama('show', { model: m.name }).catch(() => ({}))));
  // Ollama versions before capabilities existed: list every model and let the user try
  return models
    .filter((m, i) => !shown[i].capabilities || shown[i].capabilities.includes('vision'))
    .map((m) => ({ name: m.name, fits: fitsInMemory(m.size) }));
}

function fitsInMemory(size) {
  return !size || size * MEMORY_PER_FILE_SIZE < os.totalmem() * MAX_MODEL_MEMORY_SHARE;
}

// The model to suggest downloading on this Mac, or undefined when none fits
function recommendedModel() {
  return RECOMMENDED_MODELS.find((m) => fitsInMemory(m.size));
}

// The model 'auto' uses: the best installed recommended one, else the first that fits
function preferredModel(models) {
  const usable = models.filter((m) => m.fits);
  const ranked = RECOMMENDED_MODELS.map((r) => usable.find((m) => m.name === r.name)).filter(Boolean);
  return (ranked[0] ?? usable[0])?.name;
}

// What's missing before Ollama can read images: 'missing' (not installed), 'stopped', 'no-model', or null
async function ollamaSetupStep() {
  try {
    const models = await ollamaVisionModels();
    return models.some((m) => m.fits) || !recommendedModel() ? null : 'no-model';
  } catch {
    return [...OLLAMA_APP_PATHS, ...OLLAMA_CLI_PATHS].some((p) => fs.existsSync(p)) ? 'stopped' : 'missing';
  }
}

// Opens the Ollama app and waits for its server. Resolves with an error message or null.
async function startOllama() {
  const appPath = OLLAMA_APP_PATHS.find((p) => fs.existsSync(p));
  if (!appPath) return 'Start Ollama from Terminal with: ollama serve';
  execFile('open', ['-g', appPath]);
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      await ollama('version');
      return null;
    } catch {}
  }
  return 'Ollama didn\'t start. Open it from Applications and try again.';
}

// Downloads the recommended model, reporting progress from 0 to 1. Resolves with an error message or null.
async function downloadRecommendedModel(onProgress) {
  const model = recommendedModel();
  if (!model) return 'This Mac doesn\'t have enough memory for a model that reads images.';
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.name, stream: true })
    });
  } catch {
    return 'Ollama isn\'t running. Open the Ollama app and try again.';
  }
  if (!response.ok) return `Ollama answered with HTTP ${response.status}.`;
  // One JSON object per line; each file of the model reports its own total
  const files = new Map();
  let buffered = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const update = JSON.parse(line);
      if (update.error) return `Ollama: ${update.error}`;
      if (update.digest && update.total) files.set(update.digest, update);
      const total = [...files.values()].reduce((sum, f) => sum + f.total, 0);
      const done = [...files.values()].reduce((sum, f) => sum + (f.completed ?? 0), 0);
      if (total) onProgress(done / total);
      if (update.status === 'success') return null;
    }
  }
  return 'The download stopped before it finished. Try again to resume it.';
}

// Frees the memory of the model MacMath last used. Called when MacMath quits.
async function unloadOllamaModel() {
  if (!loadedOllamaModel) return;
  const model = loadedOllamaModel;
  loadedOllamaModel = null;
  await ollama('generate', { model, keep_alive: 0 }, 2000).catch(() => {});
}

// PNG as base64, scaled down when large. nativeImage also opens HEIC and TIFF, which Ollama can't.
function imageForOllama(file) {
  let image = nativeImage.createFromPath(file);
  if (image.isEmpty()) throw new Error('Couldn\'t open the image.');
  const { width, height } = image.getSize();
  if (Math.max(width, height) > MAX_IMAGE_SIDE) {
    image = width >= height
      ? image.resize({ width: MAX_IMAGE_SIDE, quality: 'best' })
      : image.resize({ height: MAX_IMAGE_SIDE, quality: 'best' });
  }
  return image.toPNG().toString('base64');
}

async function recognizeWithOllama(model, file) {
  try {
    // A saved choice can predate the size check in the picker
    const info = (await ollamaVisionModels().catch(() => [])).find((m) => m.name === model);
    if (info && !info.fits) return { error: `${model} needs more memory than this Mac has. Choose a smaller model under Import.` };
    loadedOllamaModel = model;
    const data = await ollama('chat', {
      model,
      stream: false,
      keep_alive: KEEP_ALIVE,
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: INSTRUCTIONS },
        { role: 'user', content: PROMPT, images: [imageForOllama(file)] }
      ]
    }, OLLAMA_TIMEOUT);
    return { text: data.message?.content ?? '' };
  } catch (err) {
    return { error: err.message };
  }
}

// --- Engines ---

// For the picker: { engines: [{ id, label, disabled?, title? }], selected, setup }.
// setup is the next Ollama step to offer ('missing', 'stopped', 'no-model') when nothing can read images yet.
async function listEngines() {
  const appleReason = await appleUnavailableReason();
  const engines = [
    { id: 'auto', label: 'Automatic' },
    { id: 'apple', label: appleReason ? 'Apple Intelligence (unavailable)' : 'Apple Intelligence', title: appleReason || undefined }
  ];
  try {
    const models = await ollamaVisionModels();
    for (const { name, fits } of models) {
      if (!fits) {
        engines.push({ id: `ollama:${name}`, label: `Ollama: ${name} (too large for this Mac)`, disabled: true });
      } else {
        engines.push({ id: `ollama:${name}`, label: `Ollama: ${name}${name === recommendedModel()?.name ? ' (recommended)' : ''}` });
      }
    }
    if (!models.some((m) => m.fits)) engines.push({ id: 'ollama-none', label: 'Ollama: no vision models installed', disabled: true });
  } catch {
    engines.push({ id: 'ollama-none', label: 'Ollama: not running', disabled: true });
  }
  // Keep a saved model that's gone (Ollama closed, model removed) visible rather than switching silently
  const selected = getEngine();
  if (!engines.some((e) => e.id === selected)) {
    engines.push({ id: selected, label: `Ollama: ${selected.slice('ollama:'.length)} (not found)` });
  }
  const setup = appleReason ? await ollamaSetupStep() : null;
  return { engines, selected, setup, recommended: recommendedModel() };
}

// What 'auto' means right now
async function resolveAuto() {
  const appleReason = await appleUnavailableReason();
  if (!appleReason) return { engine: 'apple' };
  try {
    const model = preferredModel(await ollamaVisionModels());
    if (model) return { engine: `ollama:${model}` };
    return { error: `${appleReason} Or download a model for Ollama under Import.` };
  } catch {
    return { error: `${appleReason} Or set up Ollama under Import.` };
  }
}

// Checks the engine before a file dialog opens, so the user isn't asked for a file for nothing.
// Returns an error message or null.
async function unavailableReason() {
  const engine = getEngine();
  if (engine === 'auto') return (await resolveAuto()).error ?? null;
  if (engine === 'apple') return appleUnavailableReason();
  return null; // Ollama errors are clear enough when they happen
}

// The model sometimes wraps its answer in a code fence, math delimiters or thinking
function cleanLatex(text) {
  let latex = String(text).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  latex = latex.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  for (const [open, close] of [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)'], ['$', '$']]) {
    if (latex.startsWith(open) && latex.endsWith(close) && latex.length > open.length + close.length) {
      latex = latex.slice(open.length, -close.length).trim();
      break;
    }
  }
  return simplifyBraces(tidyEnvironments(tidyLatex(latex)));
}

const OPERATOR_NAMES = ['lim', 'sin', 'cos', 'tan', 'log', 'ln', 'exp', 'max', 'min', 'sup', 'inf', 'det', 'arg'];

// Models trained on spaced-out LaTeX answer like `b ^ { 2 } - 4 a c`. MathLive keeps LaTeX as
// written, so that would be copied too. Spaces in math mode only matter after a command name
// (\sin x) and inside text, so keep those and drop the rest.
function tidyLatex(latex) {
  let out = '';
  let textDepth = 0; // > 0 inside \text{…} and similar, where spaces are words
  let depth = 0;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === '\\') {
      const command = latex.slice(i).match(/^\\([a-zA-Z]+|.)/)[0];
      out += command;
      i += command.length - 1;
      if (!textDepth && /^\\(text|textrm|textit|textbf|mbox|mathrm)$/.test(command)) {
        // the argument's opening brace comes next, possibly after spaces
        while (/\s/.test(latex[i + 1] ?? '')) i++;
        if (latex[i + 1] === '{') {
          out += '{';
          i++;
          depth++;
          textDepth = depth;
        }
      }
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      if (depth === textDepth) {
        // Keep a final space when math follows directly: \text{if }x
        const spaced = /\s$/.test(out) && /^\s*([a-zA-Z0-9]|\\(?!right|end)[a-zA-Z])/.test(latex.slice(i + 1));
        out = out.trimEnd() + (spaced ? ' ' : '');
        textDepth = 0;
      }
      depth--;
    }
    if (/\s/.test(ch)) {
      if (textDepth) {
        if (!/\s$|\{$/.test(out)) out += ' ';
      } else if (/\\[a-zA-Z]+$/.test(out) && /[a-zA-Z]/.test(latex.slice(i).trimStart()[0] ?? '')) {
        // \sin x: the space ends the command name
        out += ' ';
      }
      while (/\s/.test(latex[i + 1] ?? '')) i++;
      continue;
    }
    out += ch;
  }
  // \operatorname*{lim} -> \lim
  return out.replace(/\\operatorname\*?\{([a-z]+)\}(?=(.?))/g, (m, name, next) => {
    if (!OPERATOR_NAMES.includes(name)) return m;
    return /[a-zA-Z]/.test(next) ? `\\${name} ` : `\\${name}`;
  });
}

// Index of the } that closes the { at `open`
function closingBrace(latex, open) {
  let depth = 0;
  for (let i = open; i < latex.length; i++) {
    if (latex[i] === '\\') i++;
    else if (latex[i] === '{') depth++;
    else if (latex[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

// True when the whole string is one {…} group
function isOneGroup(text) {
  return text.startsWith('{') && closingBrace(text, 0) === text.length - 1;
}

// Splits an environment body at a separator ('\\' or '&') outside braces and nested environments
function splitTopLevel(body, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body.startsWith('\\begin{', i) || body.startsWith('\0begin{', i)) depth++;
    else if (body.startsWith('\\end{', i) || body.startsWith('\0end{', i)) depth--;
    if (body[i] === '{') depth++;
    else if (body[i] === '}') depth--;
    else if (depth === 0 && body.startsWith(separator, i) && !(separator === '&' && body[i - 1] === '\\')) {
      parts.push(body.slice(start, i));
      start = i + separator.length;
      i += separator.length - 1;
      continue;
    }
    if (body[i] === '\\') i++; // skip the escaped character (\{, \&, the second \ of \\)
  }
  parts.push(body.slice(start));
  return parts;
}

// Delimiters around an array that mean a named environment instead
const DELIMITED_ENVIRONMENTS = [
  ['\\left(', '\\right)', 'pmatrix'],
  ['\\left[', '\\right]', 'bmatrix'],
  ['\\left\\{', '\\right\\}', 'Bmatrix'],
  ['\\left|', '\\right|', 'vmatrix'],
  ['\\left\\|', '\\right\\|', 'Vmatrix'],
  ['\\left\\{', '\\right.', 'cases']
];

// Models trained on older LaTeX write every matrix, determinant and case split as
// \left( \begin{array}{ll} {1} & {2} \end{array} \right). Use the named environments, drop
// the braces around each cell, and drop array columns that nothing uses.
function tidyEnvironments(latex) {
  // Innermost first: the last \begin has no environment inside it.
  // Finished ones are marked with \0 so the loop moves on; the marks are removed at the end.
  for (;;) {
    const begin = latex.lastIndexOf('\\begin{');
    if (begin < 0) break;
    const header = latex.slice(begin).match(/^\\begin\{(\w+\*?)\}/);
    if (!header) {
      latex = latex.slice(0, begin) + '\0' + latex.slice(begin + 1);
      continue;
    }
    let name = header[1];
    let bodyStart = begin + header[0].length;
    let columns = null;
    if (name === 'array' && latex[bodyStart] === '{') {
      const close = closingBrace(latex, bodyStart);
      columns = latex.slice(bodyStart + 1, close);
      bodyStart = close + 1;
    }
    const endTag = `\\end{${name}}`;
    const end = latex.indexOf(endTag, bodyStart);
    if (end < 0) {
      latex = latex.slice(0, begin) + '\0' + latex.slice(begin + 1);
      continue;
    }

    const rows = splitTopLevel(latex.slice(bodyStart, end), '\\\\')
      .map((row) => splitTopLevel(row, '&').map((cell) => {
        const trimmed = cell.trim();
        return isOneGroup(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
      }));
    if (rows.length > 1 && rows.at(-1).every((cell) => !cell)) rows.pop();
    const used = Math.max(...rows.map((row) => row.length));
    const body = rows.map((row) => row.join('&')).join('\\\\');

    let before = latex.slice(0, begin);
    let after = latex.slice(end + endTag.length);
    if (name === 'array') {
      const outer = DELIMITED_ENVIRONMENTS.find(([open, close, env]) =>
        before.trimEnd().endsWith(open) && after.trimStart().startsWith(close) && (env !== 'cases' || used <= 2));
      if (outer) {
        const [open, close, env] = outer;
        before = before.trimEnd().slice(0, -open.length);
        after = after.trimStart().slice(close.length);
        name = env;
        columns = null;
      } else if (!columns.includes('|')) {
        columns = columns.replace(/\s/g, '').slice(0, used) || 'l';
      }
    }
    const opening = `\0begin{${name}}` + (columns === null ? '' : `{${columns}}`);
    latex = before + opening + body + `\0end{${name}}` + after;
  }
  return latex.replace(/\0/g, '\\');
}

// Leftover grouping that makes the LaTeX harder to read: {{x}}, {\binom{n}{x}} after =,
// x^{2}, and \overline{x} on a single letter (written \bar{x} by hand)
function simplifyBraces(latex) {
  let out = latex;
  for (let i = out.indexOf('{'); i >= 0; i = out.indexOf('{', i + 1)) {
    if (out[i - 1] === '\\') continue;
    const close = closingBrace(out, i);
    if (close < 0) break;
    const inner = out.slice(i + 1, close);
    const previous = out.slice(0, i).trimEnd().slice(-1);
    const doubled = isOneGroup(inner);
    const standalone = /^\\[a-zA-Z]+\{/.test(inner) && isWholeCommand(inner) && (!previous || /[=+\-<>(,&]/.test(previous));
    if (doubled || standalone) {
      out = out.slice(0, i) + inner + out.slice(close + 1);
      i--;
    }
  }
  return out
    // Text spelled out letter by letter, with ~ between words: \mathrm{a t ~ l e a s t}
    .replace(/\\(text|mathrm)\{([a-zA-Z~ ]+)\}/g, (m, command, content) => {
      const tokens = content.trim().split(/\s+/);
      if (!content.includes('~') || !tokens.every((t) => t.length === 1) || tokens.filter((t) => t !== '~').length < 2) return m;
      const words = content.split('~').map((word) => word.replace(/\s+/g, '')).filter(Boolean);
      // Several words are a phrase; one word (kg, max) keeps its command
      return `\\${words.length > 1 ? 'text' : command}{${words.join(' ')}}`;
    })
    .replace(/([\^_])\{([a-zA-Z0-9])\}(?![a-zA-Z0-9])/g, '$1$2')
    .replace(/\\overline\{([a-zA-Z])\}/g, '\\bar{$1}');
}

// \binom{n}{x} or \frac{a}{b}: one command and its arguments, nothing after them
function isWholeCommand(text) {
  let i = text.match(/^\\[a-zA-Z]+/)[0].length;
  while (text[i] === '{') {
    i = closingBrace(text, i) + 1;
    if (i === 0) return false;
  }
  return i === text.length;
}

// Resolves with { latex } or { error }
async function recognizeImage(file) {
  if (recognizing) return { error: 'Already reading an image.', busy: true };
  recognizing = true;
  try {
    let engine = getEngine();
    if (engine === 'auto') {
      const resolved = await resolveAuto();
      if (resolved.error) return { error: resolved.error };
      engine = resolved.engine;
    }
    const result = engine === 'apple'
      ? await recognizeWithApple(file)
      : await recognizeWithOllama(engine.slice('ollama:'.length), file);
    if (result.error) return { error: result.error };
    const latex = cleanLatex(result.text);
    return latex ? { latex } : { error: 'No math found in the image.' };
  } finally {
    recognizing = false;
  }
}

function isRecognizing() {
  return recognizing;
}

// The pasted image as a file: { file, temporary } or { error }.
// Copying a file in Finder puts its URL on the clipboard, and the picture data next to it is
// the file's icon, so the URL comes first. A copied screenshot is image data only.
// (Electron 44 replaced clipboard.readImage() with the async, ClipboardItem-based read().)
async function clipboardImage() {
  const [item] = await clipboard.read();
  if (!item) return { error: 'The clipboard is empty.' };

  if (item.types.includes('text/uri-list')) {
    const uris = (await (await item.getType('text/uri-list')).text()).split(/\r?\n/);
    for (const uri of uris) {
      if (!uri.startsWith('file:')) continue;
      const file = fileURLToPath(uri.trim());
      if (isImageFile(file)) return { file, temporary: false };
    }
  }

  // Image data: a standard MIME type, or the macOS pasteboard types for PNG and TIFF
  const type = item.types.find((t) => t.startsWith('image/')) ||
    item.types.find((t) => /format="public\.(png|tiff)"/.test(t));
  if (!type) return { error: 'The clipboard has no image.' };
  const extension = /tiff/.test(type) ? 'tiff' : 'png';
  const data = Buffer.from(await (await item.getType(type)).arrayBuffer());
  const file = path.join(app.getPath('temp'), `macmath-paste-${process.pid}-${Date.now()}.${extension}`);
  await fs.promises.writeFile(file, data);
  return { file, temporary: true };
}

module.exports = { startOllama, downloadRecommendedModel, unloadOllamaModel, cleanLatex, isRecognizing, clipboardImage, IMAGE_EXTENSIONS, isImageFile, listEngines, getEngine, setEngine, unavailableReason, recognizeImage };
