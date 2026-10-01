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
  }
});
