const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // The clipboard module is not available in sandboxed renderers; main writes it
  copyText(text) {
    return ipcRenderer.invoke('copy-text', text);
  },
  resizeWindow(width, height, anchor) {
    ipcRenderer.send('resize-window', width, height, anchor);
  },
  onPopoverShown(callback) {
    ipcRenderer.on('popover-shown', (event, limits) => callback(limits));
  },
  onPopoverHidden(callback) {
    ipcRenderer.on('popover-hidden', () => callback());
  },
  // Resolves with { engines: [{ id, label, disabled?, title? }], selected, setup, recommended }
  imageEngines() {
    return ipcRenderer.invoke('image-engines');
  },
  setImageEngine(engine) {
    return ipcRenderer.invoke('set-image-engine', engine);
  },
  // step is listEngines' setup value; resolves with an error message or null
  ollamaSetup(step) {
    return ipcRenderer.invoke('ollama-setup', step);
  },
  onOllamaDownloadProgress(callback) {
    ipcRenderer.on('ollama-download-progress', (event, progress) => callback(progress));
  },
  // Each resolves with { latex }, { error } or { canceled }
  recognizeImageFile() {
    return ipcRenderer.invoke('recognize-image-file');
  },
  recognizeClipboardImage() {
    return ipcRenderer.invoke('recognize-clipboard-image');
  },
  // An image dropped on the menu bar icon
  onRecognitionStarted(callback) {
    ipcRenderer.on('recognition-started', () => callback());
  },
  onRecognitionResult(callback) {
    ipcRenderer.on('recognition-result', (event, result) => callback(result));
  }
});
