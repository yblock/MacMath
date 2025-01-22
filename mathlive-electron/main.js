// main.js
const { app, BrowserWindow, Menu, Tray, nativeImage } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 400,
    show: false,            // Keep hidden initially (we'll show/hide from tray icon)
    frame: false,           // No standard title bar
    resizable: false,
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
  // Provide a small icon for your tray. Ideally an opaque background for dark mode compatibility.
  const iconPath = path.join(__dirname, 'src', 'icon.png');
  // tray = new Tray(iconPath);
  let trayIcon = nativeImage.createFromPath(iconPath);
  trayIcon = trayIcon.resize({ width: 16, height: 16 });
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip('MacMath Editor');
  Menu.setApplicationMenu(null);

  // Right-click menu
  const trayMenu = Menu.buildFromTemplate([
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ]);

  // Left-click to open/close the window
  tray.on('click', () => {
    toggleWindow();
  });

  // Right-click to show the context menu (Quit, etc.)
  tray.on('right-click', () => {
    tray.popUpContextMenu(trayMenu);
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

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();
  app.dock.hide();

  // re-create the window when the app is activated (e.g., after clicking dock icon)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Do nothing so the tray icon can keep the app running
});

