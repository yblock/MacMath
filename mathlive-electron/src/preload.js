// preload.js
const { contextBridge, clipboard } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  copyText(text) {
    return new Promise((resolve, reject) => {
      try {
        clipboard.writeText(text);
        console.log("Clipboard copied via electronAPI:", text);
        resolve();
      } catch (err) {
        console.error("Failed to copy text via electronAPI:", err);
        reject(err);
      }
    });
  }
});

