// @ts-check
'use strict';

const electron = require('electron');

// Auto-heal if launched in an environment where ELECTRON_RUN_AS_NODE is active
if (typeof electron === 'string') {
  const cp = require('node:child_process');
  const path = require('node:path');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.FLOW_TEST_LAUNCH;
  const targetDir = path.resolve(__dirname, '../../');
  const child = cp.spawn(electron, [targetDir], {
    env,
    stdio: 'inherit'
  });
  child.on('exit', (code) => {
    process.exit(code || 0);
  });
  // Keep process alive while electron runs
  setInterval(() => {}, 10000);
  return;
}

const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, session } = electron;
const path = require('node:path');
const fs = require('node:fs');
const { FlowDatabase } = require('../db/database.js');
const { HelperSupervisor } = require('../services/helperSupervisor.js');
const { LocalEngineSupervisor } = require('../services/localEngineSupervisor.js');
const { WindowManager } = require('./windowManager.js');
const { DictationCoordinator } = require('../services/dictationCoordinator.js');

// Optimize Chromium flags for low-latency microphone access without gesture locks
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');

let db = null;
let helper = null;
let localEngineDaemon = null;
let windowManager = null;
let coordinator = null;
let tray = null;

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (windowManager?.hubWindow && !windowManager.hubWindow.isDestroyed()) {
      if (windowManager.hubWindow.isMinimized()) windowManager.hubWindow.restore();
      windowManager.hubWindow.show();
      windowManager.hubWindow.focus();
    } else if (windowManager) {
      windowManager.createHubWindow();
    }
  });

  app.whenReady().then(async () => {
    // Grant microphone and audio capture permissions to Electron webContents
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'media') return callback(true);
      return callback(true);
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      if (permission === 'media') return true;
      return true;
    });

    initDatabase();
    initWindowManager();
    initHelperSupervisor();
    initLocalEngineDaemon();
    initDictationCoordinator();
    initTray();
    registerGlobalShortcuts();
    registerIpcHandlers();

    // Show Main Hub on first launch
    windowManager.createHubWindow();
    windowManager.createPillWindow();

    console.log('[Flow Main] Desktop application shell initialized successfully');

    if (process.env.FLOW_TEST_LAUNCH === '1') {
      console.log('[Flow Main] Test launch mode active. Exiting cleanly after verification...');
      setTimeout(() => {
        app.isQuitting = true;
        app.quit();
      }, 1500);
    }
  });
}

function initDatabase() {
  db = new FlowDatabase();
  console.log('[Flow Main] Local SQLite initialized at:', db.dbPath);
}

function initWindowManager() {
  windowManager = new WindowManager();
}

function initHelperSupervisor() {
  helper = new HelperSupervisor({
    helperPath: path.resolve(__dirname, '../../native/FlowHelper.exe')
  });

  helper.on('status', (status) => {
    console.log('[Flow Main] Helper supervisor status:', status);
    windowManager?.broadcast('flow:helper-status', status);
  });

  helper.start();
}

function initLocalEngineDaemon() {
  localEngineDaemon = new LocalEngineSupervisor({ port: 8089 });
  if (localEngineDaemon.isInstalled()) {
    console.log('[Flow Main] Initializing local on-device engine daemon...');
    localEngineDaemon.start();
  }
}

function initDictationCoordinator() {
  coordinator = new DictationCoordinator({
    db,
    helper,
    windowManager
  });
}

function createTrayIcon() {
  const iconPath = path.resolve(__dirname, '../../assets/icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  // Fallback 16x16 raw RGBA buffer
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buffer[i * 4] = 124;     // R
    buffer[i * 4 + 1] = 58;  // G
    buffer[i * 4 + 2] = 237; // B
    buffer[i * 4 + 3] = 255; // A
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function initTray() {
  try {
    const icon = createTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip('IndicFlow');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Hub',
        click: () => windowManager.createHubWindow()
      },
      {
        label: 'Toggle Dictation',
        click: () => {
          if (coordinator.state === 'idle') {
            coordinator.startDictation();
          } else {
            coordinator.requestStopFromRenderer();
          }
        }
      },
      {
        label: 'Settings',
        click: () => {
          const win = windowManager.createHubWindow();
          win.webContents.executeJavaScript(`switchTab && switchTab('settings')`).catch(() => {});
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      windowManager.toggleHub();
    });
  } catch (err) {
    console.warn('[Flow Main] Failed to initialize system tray:', err.message);
  }
}

function registerGlobalShortcuts() {
  // Register fallback desktop shortcuts
  try {
    globalShortcut.register('CommandOrControl+Alt+Space', () => {
      if (coordinator.state === 'idle') {
        coordinator.startDictation();
      } else {
        coordinator.requestStopFromRenderer();
      }
    });

    globalShortcut.register('Alt+D', () => {
      if (coordinator.state === 'idle') {
        coordinator.startDictation();
      } else {
        coordinator.requestStopFromRenderer();
      }
    });
  } catch (err) {
    console.warn('[Flow Main] Could not register global shortcuts:', err.message);
  }
}

function registerIpcHandlers() {
  // Dictation State
  ipcMain.handle('flow:get-state', () => {
    return { state: coordinator.state };
  });

  ipcMain.handle('flow:start-dictation', async () => {
    await coordinator.startDictation();
    return { success: true };
  });

  ipcMain.handle('flow:stop-dictation', async (_event, audioData) => {
    let audioPayload = audioData;
    if (audioData) {
      if (Array.isArray(audioData)) {
        audioPayload = Buffer.from(audioData);
      } else if (audioData.buffer && audioData.byteLength) {
        audioPayload = Buffer.from(audioData.buffer);
      }
    }
    await coordinator.stopDictation(audioPayload);
    return { success: true };
  });

  ipcMain.handle('flow:cancel-dictation', () => {
    coordinator.cancelDictation();
    return { success: true };
  });

  // History Handlers
  ipcMain.handle('flow:get-history', (_event, limit = 50, offset = 0, query = '') => {
    return db.getHistory(limit, offset, query);
  });

  ipcMain.handle('flow:delete-history', (_event, id) => {
    return db.deleteHistory(id);
  });

  ipcMain.handle('flow:clear-history', () => {
    db.clearHistory();
    return { success: true };
  });

  // Dictionary Handlers
  ipcMain.handle('flow:get-dictionary', () => {
    return db.getDictionary();
  });

  ipcMain.handle('flow:add-dictionary', (_event, phrase, replacement) => {
    return db.addDictionaryWord(phrase, replacement);
  });

  ipcMain.handle('flow:delete-dictionary', (_event, id) => {
    return db.deleteDictionaryWord(id);
  });

  // Settings Handlers
  ipcMain.handle('flow:get-settings', () => {
    return db.getAllSettings();
  });

  ipcMain.handle('flow:set-setting', (_event, key, value) => {
    db.setSetting(key, value);
    // Dynamically refresh STT service credentials
    if (coordinator?.sttService) {
      if (key === 'gnaniApiKey') coordinator.sttService.updateCredentials({ gnaniApiKey: value });
      if (key === 'gnaniModel') coordinator.sttService.updateCredentials({ gnaniModel: value });
      if (key === 'gnaniLanguage') coordinator.sttService.updateCredentials({ gnaniLanguage: value });
      if (key === 'primaryProvider') coordinator.sttService.updateCredentials({ primaryProvider: value });
      if (key === 'geminiApiKey') coordinator.sttService.updateCredentials({ geminiApiKey: value });
      if (key === 'geminiModel') coordinator.sttService.updateCredentials({ geminiModel: value });
      if (key === 'groqApiKey') coordinator.sttService.updateCredentials({ groqApiKey: value });
      if (key === 'openaiApiKey') coordinator.sttService.updateCredentials({ openaiApiKey: value });
    }
    return { success: true };
  });

  ipcMain.handle('flow:get-local-engine-status', () => {
    if (coordinator?.sttService?.hasLocalEngineBinary) {
      return coordinator.sttService.hasLocalEngineBinary();
    }
    return { ready: false, exePath: null, modelPath: null };
  });

  ipcMain.handle('flow:get-local-whisper-status', () => {
    if (coordinator?.sttService?.hasLocalEngineBinary) {
      return coordinator.sttService.hasLocalEngineBinary();
    }
    return { ready: false, exePath: null, modelPath: null };
  });

  // Notes Handlers
  ipcMain.handle('flow:get-notes', () => {
    return db.getNotes();
  });

  ipcMain.handle('flow:save-note', (_event, title, content, id) => {
    return db.saveNote(title, content, id);
  });

  ipcMain.handle('flow:delete-note', (_event, id) => {
    return db.deleteNote(id);
  });

  // Window Controls
  ipcMain.handle('flow:open-hub', (_event, tab) => {
    const win = windowManager.createHubWindow();
    if (tab) {
      win.webContents.executeJavaScript(`switchTab && switchTab('${tab}')`).catch(() => {});
    }
    return { success: true };
  });

  ipcMain.handle('flow:window-minimize', () => {
    windowManager?.hubWindow?.minimize();
  });

  ipcMain.handle('flow:window-maximize', () => {
    if (windowManager?.hubWindow) {
      if (windowManager.hubWindow.isMaximized()) {
        windowManager.hubWindow.unmaximize();
      } else {
        windowManager.hubWindow.maximize();
      }
    }
  });

  ipcMain.handle('flow:window-close', () => {
    windowManager?.hubWindow?.hide();
  });

  ipcMain.handle('flow:get-helper-status', () => {
    return {
      status: helper?.isReady ? 'connected' : 'disconnected',
      ready: Boolean(helper?.isReady),
      pid: helper?.process?.pid || null
    };
  });

  ipcMain.on('flow:client-audio-levels', (_event, levels) => {
    windowManager?.pillWindow?.webContents.send('flow:audio-levels', levels);
  });
}

// Keep app alive in tray when windows are closed
app?.on('window-all-closed', (e) => {
  // Don't quit, keep running in background tray
});

app?.on('will-quit', () => {
  globalShortcut.unregisterAll();
  helper?.stop();
  localEngineDaemon?.stop();
  db?.close();
});
