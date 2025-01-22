// preload.js
const { contextBridge, clipboard } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  copyText(text) {
    clipboard.writeText(text);
    console.log("Clipboard copied via electronAPI:", text);
  }
});

