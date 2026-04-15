const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, globalShortcut } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 380,
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
    if (!mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.hide();
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
}

function toggleWindow() {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
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

  mainWindow.setPosition(x, y, false);
  mainWindow.show();
  mainWindow.focus();
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

ipcMain.on('resize-window', (event, width, height) => {
  if (mainWindow) {
    mainWindow.setSize(width, height);
  }
});

// App lifecycle
app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
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

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Do nothing so the tray icon can keep the app running
});

