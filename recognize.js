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
// A tightly cropped inline formula can be 20 px tall, too small for the models to read
const MIN_CONTENT_HEIGHT = 96;
const MAX_UPSCALE = 4;
// A pixel that differs from the background by more than this in any channel is ink
const INK_THRESHOLD = 40;
// Space around the math after cropping, a quarter of its height within these limits
const MIN_MARGIN = 16;
const MAX_MARGIN = 48;

// Same instructions as native/mathocr.swift. Chosen by testing prompts on rendered textbook
// formulas: rules about matrix environments made the models swap bracket types (tidyEnvironments
// handles those instead), and a rule about several lines made qwen2.5vl:7b wrap every formula in aligned.
// Without the \mathrm rule, physics notation came back as \text{F}_{\text{net}}=m\text{a} (12 bold-vector
// and subscript-label formulas: 12 right with it, 6 without; no change on the 30 statistics formulas).
const INSTRUCTIONS = 'You transcribe mathematics from images into LaTeX.\n' +
  'Rules:\n' +
  '- Reply with only the LaTeX. No explanation, no Markdown, no $ or $$.\n' +
  '- Write words with normal spacing inside \\text{}, for example \\text{at least one head}. Never put spaces between the letters of a word.\n' +
  '- Never use \\text{} for single letters or labels. Bold letters: \\mathbf{F}. Upright (non-italic) letters and labels: \\mathrm{}, for example \\mathbf{F}_{\\mathrm{net}} or v_{\\mathrm{i}}.\n' +
  '- Chemistry: element symbols are upright, for example \\mathrm{H}_{2}\\mathrm{O} or {}^{14}_{6}\\mathrm{C}. Every symbol is a real element; if a letter is unclear, choose the one that makes a real element.\n' +
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

function helperPath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, 'native', 'bin', name);
}

// Resolves with mathocr's JSON reply, or { error } when it can't run
function runHelper(args, name = 'mathocr') {
  const helper = helperPath(name);
  if (!fs.existsSync(helper)) {
    return Promise.resolve(name === 'mathocr' ? {
      available: false,
      reason: 'Apple Intelligence support isn\'t built into this copy of MacMath. It needs macOS 27; see the README.'
    } : { error: `${name} isn't built into this copy of MacMath.` });
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

async function recognizeWithApple(png) {
  const file = path.join(app.getPath('temp'), `macmath-image-${process.pid}-${Date.now()}.png`);
  await fs.promises.writeFile(file, png);
  try {
    const result = await runHelper(['recognize', file]);
    return result.error ? { error: result.error } : { text: result.latex ?? '' };
  } finally {
    fs.promises.unlink(file).catch(() => {});
  }
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

async function recognizeWithOllama(model, png) {
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
        { role: 'user', content: PROMPT, images: [png.toString('base64')] }
      ]
    }, OLLAMA_TIMEOUT);
    return { text: data.message?.content ?? '' };
  } catch (err) {
    return { error: err.message };
  }
}

// --- Image preparation ---

// nativeImage decodes only PNG and JPEG; macOS's sips converts the rest (HEIC, TIFF, GIF, BMP, WebP).
// Loading from a buffer keeps the real pixel size (a file named name@2x.png would open at half size).
async function loadImage(file) {
  const image = nativeImage.createFromBuffer(await fs.promises.readFile(file));
  if (!image.isEmpty()) return image;
  const png = path.join(app.getPath('temp'), `macmath-convert-${process.pid}-${Date.now()}.png`);
  try {
    await new Promise((resolve, reject) => {
      execFile('/usr/bin/sips', ['-s', 'format', 'png', file, '--out', png], { timeout: 30000 }, (err) => err ? reject(err) : resolve());
    });
    return nativeImage.createFromBuffer(await fs.promises.readFile(png));
  } catch {
    return nativeImage.createEmpty();
  } finally {
    fs.promises.unlink(png).catch(() => {});
  }
}

// The image as a PNG that both engines read well: transparency filled with white, cropped to
// the math with an even margin, small formulas enlarged and large images reduced
async function prepareImage(file) {
  const original = await loadImage(file).catch(() => nativeImage.createEmpty());
  if (original.isEmpty()) throw new Error('Couldn\'t open the image.');
  const { width, height } = original.getSize();
  const pixels = original.toBitmap();
  flattenOnWhite(pixels);

  const background = backgroundColor(pixels, width, height);
  const box = (background && inkBounds(pixels, width, height, background)) || { x: 0, y: 0, width, height };
  let scale = box.height < MIN_CONTENT_HEIGHT ? Math.min(MIN_CONTENT_HEIGHT / box.height, MAX_UPSCALE) : 1;
  scale = Math.min(scale, (MAX_IMAGE_SIDE - 2 * MAX_MARGIN) / Math.max(box.width, box.height));
  const margin = Math.round(Math.min(Math.max(box.height * scale * 0.25, MIN_MARGIN), MAX_MARGIN));

  let image = nativeImage.createFromBitmap(pixels, { width, height }).crop(box);
  if (scale !== 1) {
    image = image.resize({ width: Math.max(1, Math.round(box.width * scale)), quality: 'best' });
  }
  return pad(image, margin, background ?? [255, 255, 255]).toPNG();
}

// Screenshots and rendered formulas often have a transparent background, which a model can
// see as black behind black text. The bitmap is premultiplied BGRA, so white shows through
// as 255 - alpha in every channel.
function flattenOnWhite(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    const clear = 255 - pixels[i + 3];
    if (!clear) continue;
    pixels[i] += clear;
    pixels[i + 1] += clear;
    pixels[i + 2] += clear;
    pixels[i + 3] = 255;
  }
}

// The [b, g, r] that most of the border has, or null when the border isn't mostly one color
// (a photo, or the math runs to the edge)
function backgroundColor(pixels, width, height) {
  const counts = new Map();
  let total = 0;
  const count = (x, y) => {
    const i = (y * width + x) * 4;
    // Group close colors so JPEG noise doesn't split the background
    const key = (pixels[i] >> 4) << 8 | (pixels[i + 1] >> 4) << 4 | pixels[i + 2] >> 4;
    const entry = counts.get(key) ?? { n: 0, color: [pixels[i], pixels[i + 1], pixels[i + 2]] };
    entry.n++;
    counts.set(key, entry);
    total++;
  };
  for (let x = 0; x < width; x++) { count(x, 0); count(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { count(0, y); count(width - 1, y); }
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return top.n >= total * 0.6 ? top.color : null;
}

// The smallest rectangle around everything that isn't background, or null when there's nothing
function inkBounds(pixels, width, height, background) {
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInk(pixels, (y * width + x) * 4, background)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function isInk(pixels, i, background) {
  return Math.abs(pixels[i] - background[0]) > INK_THRESHOLD ||
    Math.abs(pixels[i + 1] - background[1]) > INK_THRESHOLD ||
    Math.abs(pixels[i + 2] - background[2]) > INK_THRESHOLD;
}

function pad(image, margin, [b, g, r]) {
  const { width, height } = image.getSize();
  const source = image.toBitmap();
  const outWidth = width + 2 * margin;
  const out = Buffer.alloc(outWidth * (height + 2 * margin) * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = b;
    out[i + 1] = g;
    out[i + 2] = r;
    out[i + 3] = 255;
  }
  for (let y = 0; y < height; y++) {
    source.copy(out, ((y + margin) * outWidth + margin) * 4, y * width * 4, (y + 1) * width * 4);
  }
  return nativeImage.createFromBitmap(out, { width: outWidth, height: height + 2 * margin });
}

// --- Italic words ---

// The models write every word as \text{}, which is upright, even where the image sets it in
// italics like the variables around it (% unc r). Asked directly, qwen2.5vl:7b judged 2 of 5
// italic words right, and a prompt rule made it set single letters upright instead. So measure
// the slant: native/textboxes finds each word's box with Vision, and the shear at which the
// strokes line up best is the slant. On Arial and Times, italic words came out 9° to 13°,
// upright ones -3° to 0°.
const ITALIC_SLANT = 5;
const TEXT_GROUP = /\\text\{([^{}\\$]*)\}/g;

// \text{unc} → \mathit{unc} for every \text{} whose words are all italic in the image
async function italicizeWords(latex, png) {
  const words = new Set();
  for (const [, content] of latex.matchAll(TEXT_GROUP)) {
    for (const word of content.trim().split(/\s+/)) if (/^[A-Za-z]+$/.test(word)) words.add(word.toLowerCase());
  }
  if (!words.size) return latex;

  const file = path.join(app.getPath('temp'), `macmath-words-${process.pid}-${Date.now()}.png`);
  await fs.promises.writeFile(file, png);
  const found = await runHelper([file], 'textboxes').finally(() => fs.promises.unlink(file).catch(() => {}));
  if (!found.words) return latex;

  const image = nativeImage.createFromBuffer(png);
  const { width, height } = image.getSize();
  const pixels = image.toBitmap();
  const background = backgroundColor(pixels, width, height) ?? [255, 255, 255];
  const slants = new Map();
  for (const box of found.words) {
    const word = box.text.toLowerCase();
    // Vision sometimes gives a word the box of its whole line
    if (!words.has(word) || box.width > word.length * box.height) continue;
    const slant = slantOf(pixels, width, height, background, box);
    if (slant !== null) slants.set(word, [...slants.get(word) ?? [], slant]);
  }
  const isItalic = (word) => {
    const measured = slants.get(word.toLowerCase());
    return measured && measured.reduce((a, b) => a + b) / measured.length >= ITALIC_SLANT;
  };

  return latex.replace(TEXT_GROUP, (group, content, offset) => {
    const parts = content.trim().split(/\s+/);
    if (!parts.every(isItalic)) return group;
    // The spaces inside \text{} become thin spaces, unless an operator or the end is next to them
    const before = latex[offset - 1] ?? '';
    const after = latex[offset + group.length] ?? '';
    const lead = /^\s/.test(content) && /[A-Za-z0-9})%]/.test(before) ? '\\,' : '';
    const trail = /\s$/.test(content) && /[A-Za-z0-9\\({]/.test(after) ? '\\,' : '';
    return lead + parts.map((word) => `\\mathit{${word}}`).join('\\,') + trail;
  });
}

// The slant of the letters in a box, in degrees to the right, or null when the box is empty.
// Shearing italic letters upright stacks their strokes into the fewest, fullest columns.
function slantOf(pixels, width, height, background, box) {
  const left = Math.max(0, Math.round(box.x - box.height / 3));
  const right = Math.min(width, Math.round(box.x + box.width + box.height / 3));
  const top = Math.max(0, box.y);
  const bottom = Math.min(height, box.y + box.height);
  const ink = [];
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) if (isInk(pixels, (y * width + x) * 4, background)) ink.push(x, bottom - y);
  }
  if (ink.length < 40) return null;
  let best = null;
  for (let degrees = -10; degrees <= 30; degrees++) {
    const shear = Math.tan(degrees * Math.PI / 180);
    const columns = new Map();
    for (let i = 0; i < ink.length; i += 2) {
      const column = Math.round(ink[i] - ink[i + 1] * shear);
      columns.set(column, (columns.get(column) ?? 0) + 1);
    }
    let score = 0;
    for (const n of columns.values()) score += n * n;
    if (!best || score > best.score) best = { score, degrees };
  }
  return best.degrees;
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
  return fixIsotopeSymbols(scriptsOutOfMathrm(simplifyBraces(tidyEnvironments(tidyLatex(unwrapTextMath(latex))))));
}

// Models put chemistry's scripts inside \mathrm: \mathrm{^{14}_{6}C}, \mathrm{H_{2}O}, even
// \mathrm{^{131I}}. Only the letters are upright: {}^{14}_{6}\mathrm{C}, \mathrm{H}_{2}\mathrm{O}
function scriptsOutOfMathrm(latex) {
  const scripts = String.raw`(?:[_^](?:\{[^{}]*\}|[0-9a-zA-Z+-]))*`;
  const leading = new RegExp(`^${scripts}`);
  const piece = new RegExp(`([A-Za-z]+)(${scripts})`, 'y');
  return latex.replace(/\\mathrm\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (match, inside) => {
    if (!/[_^]/.test(inside)) return match;
    // The mass number ran into the symbol: ^{131I}
    const merged = inside.match(/^\^\{(\d+)([A-Z][a-z]?)\}$/);
    if (merged) return `{}^{${merged[1]}}\\mathrm{${merged[2]}}`;
    const before = inside.match(leading)[0];
    let out = before ? `{}${before}` : '';
    piece.lastIndex = before.length;
    let part;
    while (piece.lastIndex < inside.length && (part = piece.exec(inside))) out += `\\mathrm{${part[1]}}${part[2]}`;
    // Anything else inside (m/s^{2}) stays as it was
    return piece.lastIndex === inside.length && part ? out : match;
  });
}

// Element symbols by atomic number (index + 1)
const ELEMENTS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' +
  'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm ' +
  'Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu ' +
  'Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' ');
// Letters a blurry or low-resolution image confuses: ³He read as ³Hc
const LOOKALIKES = [['c', 'e'], ['e', 'c'], ['e', 'o'], ['o', 'e'], ['l', 'I'], ['I', 'l'], ['1', 'l'],
  ['l', '1'], ['1', 'I'], ['0', 'O'], ['O', '0'], ['rn', 'm'], ['m', 'rn'], ['u', 'n'], ['n', 'u'], ['i', 'l']];

// Isotope notation ({}^{3}\mathrm{He}, {}_{92}^{235}\mathrm{U}) is clearly chemistry, so its symbol
// must be an element. When it isn't, and swapping one lookalike makes exactly one element
// (matching the atomic number when there is one), that is what the image showed.
function fixIsotopeSymbols(latex) {
  const script = String.raw`(?:\{(\d+)\}|(\d))`;
  // The empty base may be missing at the start: ^{3}\mathrm{He}
  const isotope = new RegExp(String.raw`(?:\{\}|^)(?:_${script})?\^${script}(?:_${script})?\s*\\(mathrm|text|textrm)\{([A-Za-z0-9]{1,3})\}`, 'g');
  return latex.replace(isotope, (match, z1, z2, a1, a2, z3, z4, command, symbol) => {
    if (ELEMENTS.includes(symbol)) return match;
    const atomicNumber = Number(z1 ?? z2 ?? z3 ?? z4) || null;
    const candidates = new Set();
    for (const [from, to] of LOOKALIKES) {
      for (let i = symbol.indexOf(from); i >= 0; i = symbol.indexOf(from, i + 1)) {
        const fixed = symbol.slice(0, i) + to + symbol.slice(i + from.length);
        const z = ELEMENTS.indexOf(fixed) + 1;
        if (z && (!atomicNumber || z === atomicNumber)) candidates.add(fixed);
      }
    }
    if (candidates.size !== 1) return match;
    return match.slice(0, -symbol.length - 1) + [...candidates][0] + '}';
  });
}

// Math inside text is just math: \text{${}^3\mathrm{He}$} -> {}^3\mathrm{He}. Text around it
// stays text: \text{if $x>0$} -> \text{if }x>0
function unwrapTextMath(latex) {
  let out = latex;
  const pattern = /\\(text|textrm|mbox)\s*\{/g;
  let match;
  while ((match = pattern.exec(out))) {
    const open = match.index + match[0].length - 1;
    const close = closingBrace(out, open);
    if (close < 0) break;
    const parts = splitAtDollars(out.slice(open + 1, close));
    if (!parts) continue;
    // Text at even positions, math at odd ones
    let replacement = parts.map((part, i) => (i % 2 || !part ? part : `\\${match[1]}{${part}}`)).join('');
    // A script's argument stays one group: x^\text{$ab$} -> x^{ab}
    if (/[\^_]\s*$/.test(out.slice(0, match.index))) replacement = `{${replacement}}`;
    out = out.slice(0, match.index) + replacement + out.slice(close + 1);
    pattern.lastIndex = match.index + replacement.length;
  }
  return out;
}

// Splits text at unescaped $ (or $$), or returns null when there is no complete $…$ pair
function splitAtDollars(text) {
  const parts = [''];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      parts[parts.length - 1] += text.slice(i, i + 2);
      i++;
    } else if (text[i] === '$') {
      if (text[i + 1] === '$') i++;
      parts.push('');
    } else {
      parts[parts.length - 1] += text[i];
    }
  }
  return parts.length > 1 && parts.length % 2 ? parts : null;
}

const OPERATOR_NAMES = ['lim', 'sin', 'cos', 'tan', 'log', 'ln', 'exp', 'max', 'min', 'sup', 'inf', 'det', 'arg'];

// Models trained on spaced-out LaTeX answer like `b ^ { 2 } - 4 a c`. MathLive keeps LaTeX as
// written, so that would be copied too. Spaces in math mode only matter after a command name
// (\sin x) and inside text, so keep those and drop the rest.
function tidyLatex(latex) {
  let out = '';
  let textDepth = 0; // > 0 inside \text{…} and similar, where spaces are words
  let depth = 0;
  let textStart = -1; // where the text argument begins, while a leading space there matters
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
          // Keep a leading space when math comes directly before: x\text{ and }y
          textStart = /[a-zA-Z0-9})\]]$/.test(out.slice(0, -command.length)) ? out.length + 1 : -1;
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
        if (!/\s$|\{$/.test(out) || out.length === textStart) out += ' ';
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
  // Text spelled out letter by letter, with ~ between words: \mathrm{a t ~ l e a s t}
  out = out.replace(/\\(text|mathrm)\{([a-zA-Z~ ]+)\}/g, (m, command, content) => {
      const tokens = content.trim().split(/\s+/);
      if (!content.includes('~') || !tokens.every((t) => t.length === 1) || tokens.filter((t) => t !== '~').length < 2) return m;
      const words = content.split('~').map((word) => word.replace(/\s+/g, '')).filter(Boolean);
      // Several words are a phrase; one word (kg, max) keeps its command
      return `\\${words.length > 1 ? 'text' : command}{${words.join(' ')}}`;
    });
  return tidyMathrm(out)
    // A single upright letter is math, not text: \text{v} -> \mathrm{v}, so it becomes <mi>, not <mtext>
    .replace(/\\text(rm)?\{([a-zA-Z])\}/g, '\\mathrm{$2}')
    .replace(/\\textbf\{([a-zA-Z])\}/g, '\\mathbf{$1}')
    .replace(/([\^_])\{([a-zA-Z0-9])\}(?![a-zA-Z0-9])/g, '$1$2')
    .replace(/\\overline\{([a-zA-Z])\}/g, '\\bar{$1}');
}

// tidyLatex keeps spaces in \mathrm{} so simplifyBraces can join letter-spaced words. Spaces
// there don't show in math mode, so drop them afterward: \mathrm{m / s ^ {2 }} -> \mathrm{m/s^{2}}
function tidyMathrm(latex) {
  let out = latex;
  for (let i = out.indexOf('\\mathrm{'); i >= 0; i = out.indexOf('\\mathrm{', i + 1)) {
    const open = i + '\\mathrm'.length;
    const close = closingBrace(out, open);
    if (close < 0) break;
    out = out.slice(0, open + 1) + tidyLatex(out.slice(open + 1, close)) + out.slice(close);
  }
  return out;
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
    let png;
    try {
      png = await prepareImage(file);
    } catch (err) {
      return { error: err.message };
    }
    const result = engine === 'apple'
      ? await recognizeWithApple(png)
      : await recognizeWithOllama(engine.slice('ollama:'.length), png);
    if (result.error) return { error: result.error };
    const cleaned = cleanLatex(result.text);
    if (!cleaned) return { error: 'No math found in the image.' };
    return { latex: await italicizeWords(cleaned, png).catch(() => cleaned) };
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

module.exports = { prepareImage, italicizeWords, startOllama, downloadRecommendedModel, unloadOllamaModel, cleanLatex, isRecognizing, clipboardImage, IMAGE_EXTENSIONS, isImageFile, listEngines, getEngine, setEngine, unavailableReason, recognizeImage };
