const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, globalShortcut, screen, clipboard, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  IMAGE_EXTENSIONS, isImageFile, listEngines, setEngine, unavailableReason, recognizeImage, isRecognizing, clipboardImage,
  startOllama, downloadRecommendedModel, unloadOllamaModel
} = require('./recognize');

const isMac = process.platform === 'darwin';
const workspaceVisibilityOptions = {
  visibleOnFullScreen: true,
  skipTransformProcessType: true
};

// In development builds there is no LSUIElement plist entry, so hide the Dock
// icon at startup to keep the app behaving like a menu bar utility.
if (isMac && app.dock) {
  app.dock.hide();
}

const DEFAULT_WIDTH = 520;
const DEFAULT_HEIGHT = 380;

let mainWindow = null;
let tray = null;
let resetWorkspaceVisibilityTimer = null;
// While a file dialog is open the popover loses focus, but it shouldn't hide
let dialogOpen = false;

function clearWorkspaceVisibilityReset() {
  if (resetWorkspaceVisibilityTimer) {
    clearTimeout(resetWorkspaceVisibilityTimer);
    resetWorkspaceVisibilityTimer = null;
  }
}

function resetWorkspaceVisibility() {
  clearWorkspaceVisibilityReset();
  if (!isMac || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.setVisibleOnAllWorkspaces(false, workspaceVisibilityOptions);
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.hide();
  resetWorkspaceVisibility();
  // Reopen at the default size, so it is positioned under the tray icon correctly.
  // Set it here: a hidden renderer doesn't get animation frames to request it.
  mainWindow.setSize(DEFAULT_WIDTH, DEFAULT_HEIGHT);
  mainWindow.webContents.send('popover-hidden');
}

// Space the window can use without running off the screen, from its current top edge
function getWindowLimits(bounds = mainWindow.getBounds()) {
  const { workArea } = screen.getDisplayMatching(bounds);
  return {
    workArea,
    maxWidth: workArea.width,
    maxHeight: workArea.y + workArea.height - bounds.y
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }    
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Hide the window when it loses focus to behave like a popover
  mainWindow.on('blur', () => {
    if (!dialogOpen && !mainWindow.webContents.isDevToolsOpened()) {
      hideWindow();
    }
  });
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(
    path.join(__dirname, 'src', 'trayIcon.png')
  );
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip('MacMath');
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [{ role: 'quit' }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ]));

  tray.on('click', () => {
    toggleWindow();
  });

  tray.on('right-click', () => {
    tray.popUpContextMenu(buildTrayMenu());
  });

  // Dropping an image on the menu bar icon opens the popover and reads the math in it.
  // (Dragging onto the popover itself doesn't work: it hides once another app has focus.)
  tray.on('drop-files', (event, files) => {
    const image = files.find(isImageFile);
    if (!mainWindow.isVisible()) showWindow();
    const result = image
      ? startRecognition(image)
      : Promise.resolve({ error: 'Drop an image file (PNG, JPEG, HEIC, TIFF…).' });
    result.then((r) => mainWindow.webContents.send('recognition-result', r));
  });
}

function toggleWindow() {
  if (mainWindow.isVisible()) {
    hideWindow();
  } else {
    showWindow();
  }
}

function showWindow() {
  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();

  // Calculate a position just under the tray icon
  // (Horizontal center, vertical below icon)
  const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
  const y = Math.round(trayBounds.y + trayBounds.height);

  clearWorkspaceVisibilityReset();
  if (isMac) {
    // Make the popover temporarily visible across Spaces so macOS attaches it
    // to the currently active desktop instead of the desktop it last lived on.
    mainWindow.setVisibleOnAllWorkspaces(true, workspaceVisibilityOptions);
  }

  mainWindow.setPosition(x, y, false);
  mainWindow.webContents.send('popover-shown', getWindowLimits());
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();

  if (isMac) {
    resetWorkspaceVisibilityTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
        resetWorkspaceVisibilityTimer = null;
        return;
      }
      mainWindow.setVisibleOnAllWorkspaces(false, workspaceVisibilityOptions);
      resetWorkspaceVisibilityTimer = null;
    }, 250);
  }
}

function buildTrayMenu() {
  const isAutoLaunch = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: isAutoLaunch,
      click: (menuItem) => {
        app.setLoginItemSettings({ openAtLogin: menuItem.checked });
      }
    },
    { type: 'separator' },
    {
      label: 'Quit MacMath',
      click: () => app.quit()
    }
  ]);
}

ipcMain.handle('copy-text', (event, text) => clipboard.writeText(String(text)));

// --- Reading math from images (recognize.js) ---

// The renderer shows progress from here on: not while the file dialog is still open
function startRecognition(file) {
  if (!isRecognizing()) mainWindow.webContents.send('recognition-started');
  return recognizeImage(file);
}

ipcMain.handle('image-engines', () => listEngines());
ipcMain.handle('set-image-engine', (event, engine) => setEngine(engine));

// Setting up Ollama from the Import panel. Each resolves with an error message or null.
let downloadingModel = false;
ipcMain.handle('ollama-setup', async (event, step) => {
  if (step === 'missing') {
    // Installing an app is the user's call: open the download page
    await shell.openExternal('https://ollama.com/download/mac');
    return null;
  }
  if (step === 'stopped') return startOllama();
  if (step === 'no-model') {
    if (downloadingModel) return null;
    downloadingModel = true;
    try {
      return await downloadRecommendedModel((progress) => event.sender.send('ollama-download-progress', progress));
    } finally {
      downloadingModel = false;
    }
  }
  return null;
});

ipcMain.handle('recognize-image-file', async () => {
  const unavailable = await unavailableReason();
  if (unavailable) return { error: unavailable };

  dialogOpen = true;
  let choice;
  try {
    choice = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose an image of math',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }]
    });
  } finally {
    dialogOpen = false;
    mainWindow.focus();
  }
  if (choice.canceled || !choice.filePaths.length) return { canceled: true };
  return startRecognition(choice.filePaths[0]);
});

ipcMain.handle('recognize-clipboard-image', async () => {
  const image = await clipboardImage();
  if (image.error) return image;
  try {
    return await startRecognition(image.file);
  } finally {
    if (image.temporary) await fs.promises.rm(image.file, { force: true });
  }
});

// anchor 'right' keeps the right edge in place (growing left); otherwise the left edge stays
ipcMain.on('resize-window', (event, width, height, anchor) => {
  if (!mainWindow) return;

  const bounds = mainWindow.getBounds();
  const { workArea, maxWidth, maxHeight } = getWindowLimits(bounds);
  const nextWidth = Math.min(width, maxWidth);
  const nextHeight = Math.min(height, maxHeight);
  const x = anchor === 'right' ? bounds.x + bounds.width - nextWidth : bounds.x;
  const maxX = workArea.x + workArea.width - nextWidth;

  mainWindow.setBounds({
    x: Math.max(workArea.x, Math.min(x, maxX)),
    y: bounds.y,
    width: nextWidth,
    height: nextHeight
  });
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();

  const registered = globalShortcut.register('CommandOrControl+Shift+M', () => {
    toggleWindow();
  });
  if (!registered) {
    console.warn('MacMath: Failed to register global shortcut Cmd+Shift+M — it may be in use by another app');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Free the Ollama model's memory before quitting rather than leaving it loaded
let modelUnloaded = false;
app.on('before-quit', (event) => {
  if (modelUnloaded) return;
  event.preventDefault();
  unloadOllamaModel().finally(() => {
    modelUnloaded = true;
    app.quit();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Do nothing so the tray icon can keep the app running
});
