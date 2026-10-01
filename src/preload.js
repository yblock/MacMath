const { contextBridge, clipboard, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  copyText(text) {
    return new Promise((resolve, reject) => {
      try {
        clipboard.writeText(text);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
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
