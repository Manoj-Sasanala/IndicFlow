// @ts-check
'use strict';

const { BrowserWindow, screen, app } = require('electron');
const path = require('node:path');

class WindowManager {
  constructor() {
    /** @type {BrowserWindow | null} */
    this.pillWindow = null;
    /** @type {BrowserWindow | null} */
    this.hubWindow = null;

    this.pillWidth = 230;
    this.pillHeight = 52;
  }

  createPillWindow() {
    if (this.pillWindow && !this.pillWindow.isDestroyed()) {
      return this.pillWindow;
    }

    this.pillWindow = new BrowserWindow({
      width: this.pillWidth,
      height: this.pillHeight,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: false,       // Non-activating window: will not steal focus from target input!
      skipTaskbar: true,     // Hidden from Windows taskbar
      hasShadow: false,
      resizable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    });

    // Keep always-on-top above all windows, including fullscreen apps
    this.pillWindow.setAlwaysOnTop(true, 'screen-saver');
    this.pillWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    this.pillWindow.loadFile(path.join(__dirname, '../renderer/pill/index.html'));

    this.pillWindow.on('closed', () => {
      this.pillWindow = null;
    });

    return this.pillWindow;
  }

  createHubWindow() {
    if (this.hubWindow && !this.hubWindow.isDestroyed()) {
      if (this.hubWindow.isMinimized()) this.hubWindow.restore();
      this.hubWindow.show();
      this.hubWindow.focus();
      return this.hubWindow;
    }

    this.hubWindow = new BrowserWindow({
      width: 1040,
      height: 700,
      minWidth: 820,
      minHeight: 520,
      frame: true,
      title: 'Wispr Flow',
      show: true,
      center: true,
      backgroundColor: '#0f1015',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    });

    this.hubWindow.loadFile(path.join(__dirname, '../renderer/hub/index.html'))
      .catch((err) => {
        console.error('[WindowManager] Failed to load Hub HTML:', err.message);
      });

    this.hubWindow.show();
    this.hubWindow.focus();

    this.hubWindow.once('ready-to-show', () => {
      this.hubWindow?.show();
      this.hubWindow?.focus();
      this.hubWindow?.setAlwaysOnTop(true);
      setTimeout(() => {
        this.hubWindow?.setAlwaysOnTop(false);
      }, 200);
    });

    this.hubWindow.on('closed', () => {
      this.hubWindow = null;
    });

    return this.hubWindow;
  }

  showPill(caretRect) {
    if (!this.pillWindow || this.pillWindow.isDestroyed()) {
      this.createPillWindow();
    }

    this.repositionPill(caretRect);
    this.pillWindow?.showInactive();
  }

  hidePill() {
    if (this.pillWindow && !this.pillWindow.isDestroyed()) {
      this.pillWindow.hide();
    }
  }

  repositionPill(caretRect) {
    if (!this.pillWindow || this.pillWindow.isDestroyed()) return;

    let targetX, targetY;
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    if (caretRect && typeof caretRect.x === 'number' && typeof caretRect.y === 'number' && caretRect.x > 0 && caretRect.y > 0) {
      // Find display where caret is located
      const display = screen.getDisplayNearestPoint({ x: caretRect.x, y: caretRect.y });
      const bounds = display.workArea;

      if (caretRect.width > 800 || caretRect.height > 600) {
        // Window-level bounding rect fallback: anchor at bottom-center of the active window
        targetX = Math.round(caretRect.x + (caretRect.width - this.pillWidth) / 2);
        targetY = Math.round(caretRect.y + caretRect.height - this.pillHeight - 48);
      } else {
        // Precise text caret rect: anchor 10px below caret line
        targetX = Math.round(caretRect.x + (caretRect.width || 0) / 2 - this.pillWidth / 2);
        targetY = Math.round(caretRect.y + (caretRect.height || 18) + 10);
      }

      // Clamp target within display bounds
      targetX = Math.max(bounds.x + 10, Math.min(targetX, bounds.x + bounds.width - this.pillWidth - 10));
      targetY = Math.max(bounds.y + 10, Math.min(targetY, bounds.y + bounds.height - this.pillHeight - 10));
    } else {
      // Fallback: bottom-center of active display
      targetX = Math.round(workArea.x + (workArea.width - this.pillWidth) / 2);
      targetY = Math.round(workArea.y + workArea.height - this.pillHeight - 48);
    }

    this.pillWindow.setBounds({
      x: targetX,
      y: targetY,
      width: this.pillWidth,
      height: this.pillHeight
    });
  }

  toggleHub() {
    if (this.hubWindow && !this.hubWindow.isDestroyed() && this.hubWindow.isVisible()) {
      this.hubWindow.hide();
    } else {
      this.createHubWindow();
    }
  }

  broadcast(channel, data) {
    if (this.pillWindow && !this.pillWindow.isDestroyed()) {
      this.pillWindow.webContents.send(channel, data);
    }
    if (this.hubWindow && !this.hubWindow.isDestroyed()) {
      this.hubWindow.webContents.send(channel, data);
    }
  }
}

module.exports = { WindowManager };
