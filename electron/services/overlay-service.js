const { BrowserWindow } = require('electron');
const path = require('path');

class OverlayService {
  constructor() {
    this.window = null;
    this.state = 'stopped';
  }

  createWindow() {
    this.window = new BrowserWindow({
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.window.loadFile(path.join(__dirname, '..', 'overlay', 'index.html'));
    this.window.setIgnoreMouseEvents(true);
    this.state = 'ready';
    return this.window;
  }

  show() {
    if (this.window) this.window.showInactive();
  }

  hide() {
    if (this.window) this.window.hide();
  }
}

module.exports = OverlayService;
