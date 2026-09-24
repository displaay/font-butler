import path from 'node:path'
import { BrowserWindow } from 'electron'

/** @type {BrowserWindow | null} */
let debugConsoleWindow = null

export function getDebugConsoleWindow() {
  return debugConsoleWindow
}

export function showDebugConsole({ dirname, onFirstOpen }) {
  if (debugConsoleWindow && !debugConsoleWindow.isDestroyed()) {
    debugConsoleWindow.show()
    debugConsoleWindow.focus()
    return debugConsoleWindow
  }
  debugConsoleWindow = new BrowserWindow({
    width: 920,
    height: 560,
    minWidth: 480,
    minHeight: 320,
    title: 'Font Buttler — Log Console',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(dirname, 'debug-console-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  void debugConsoleWindow.loadFile(path.join(dirname, 'debug-console.html'))
  debugConsoleWindow.on('closed', () => {
    debugConsoleWindow = null
  })
  if (onFirstOpen) onFirstOpen(debugConsoleWindow)
  return debugConsoleWindow
}
