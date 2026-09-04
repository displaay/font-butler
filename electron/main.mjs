import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UI = process.env.FONT_BUTLER_UI ?? process.env.FONTCASE_UI ?? 'http://127.0.0.1:43181'
const API = process.env.FONT_BUTLER_API ?? process.env.FONTCASE_API ?? 'http://127.0.0.1:43182'
const ICON_PATH = path.join(__dirname, '../build/icon.png')
const APP_ICON = fs.existsSync(ICON_PATH) ? nativeImage.createFromPath(ICON_PATH) : undefined

let mainWindow = null
let apiToken = null
const queuedFiles = []

async function ensureApiToken() {
  if (apiToken) {
    return apiToken
  }
  const response = await fetch(`${API}/api/bootstrap`)
  const data = await response.json()
  if (!response.ok || !data.token) {
    throw new Error('Could not connect to Font Butler API.')
  }
  apiToken = data.token
  return apiToken
}

function openSettings() {
  if (!mainWindow) {
    createWindow()
  }
  const win = mainWindow
  if (!win) {
    return
  }
  const send = () => win.webContents.send('open-settings')
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
  win.show()
  win.focus()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 920,
    minHeight: 620,
    title: 'Font Butler',
    icon: APP_ICON,
    backgroundColor: '#d9d4cc',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.loadURL(UI)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function openFont(filePath) {
  try {
    const token = await ensureApiToken()
    await fetch(`${API}/api/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ path: filePath }),
    })
  } catch (error) {
    console.error('Failed to open font', error)
  }
  mainWindow?.show()
  mainWindow?.focus()
}

async function clearCacheFromMenu(kind) {
  const pathByKind = {
    font: '/api/caches/font',
    office: '/api/caches/office',
  }
  const titleByKind = {
    font: 'Remove font cache',
    office: 'Remove MS Office cache',
  }
  try {
    const token = await ensureApiToken()
    const response = await fetch(`${API}${pathByKind[kind]}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Could not clear cache')
    }
  } catch (error) {
    dialog.showErrorBox(
      titleByKind[kind],
      error instanceof Error ? error.message : 'Could not clear cache',
    )
  }
}

function buildAppMenu() {
  const settingsItem = {
    label: 'Settings…',
    accelerator: 'CommandOrControl+,',
    click: openSettings,
  }
  return Menu.buildFromTemplate([
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : [
          {
            label: 'File',
            submenu: [settingsItem, { type: 'separator' }, { role: 'quit' }],
          },
        ]),
    ...(process.platform === 'darwin' ? [{ role: 'fileMenu' }] : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: 'Font cache',
      submenu: [
        {
          label: 'Remove font cache',
          click: () => {
            void clearCacheFromMenu('font')
          },
        },
        {
          label: 'Remove MS Office cache',
          click: () => {
            void clearCacheFromMenu('office')
          },
        },
      ],
    },
    { role: 'windowMenu' },
  ])
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const extra = argv.filter((arg) => /\.(ttf|otf|ttc|otc|woff2?)$/i.test(arg))
    extra.forEach((filePath) => {
      void openFont(filePath)
    })
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (app.isReady()) {
      void openFont(filePath)
    } else {
      queuedFiles.push(filePath)
    }
  })

  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.dock && APP_ICON && !APP_ICON.isEmpty() && !app.isPackaged) {
      app.dock.setIcon(APP_ICON)
    }
    Menu.setApplicationMenu(buildAppMenu())
    createWindow()
    const fromArgv = process.argv.filter((arg) =>
      /\.(ttf|otf|ttc|otc|woff2?)$/i.test(arg),
    )
    for (const filePath of [...queuedFiles, ...fromArgv]) {
      await openFont(filePath)
    }
    queuedFiles.length = 0
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}

ipcMain.handle('reveal', async (_event, filePath) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle('pick-folder', async () => {
  const options = {
    title: 'Choose a folder to watch',
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled) {
    return null
  }
  return result.filePaths[0] ?? null
})
