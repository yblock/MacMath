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
  resizeWindow(width, height) {
    ipcRenderer.send('resize-window', width, height);
  }
});
