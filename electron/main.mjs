import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UI = process.env.FONTCASE_UI ?? 'http://127.0.0.1:43181'
const API = process.env.FONTCASE_API ?? 'http://127.0.0.1:43182'

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
    throw new Error('Could not connect to Fontcase API.')
  }
  apiToken = data.token
  return apiToken
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 920,
    minHeight: 620,
    title: 'Fontcase',
    backgroundColor: '#d9d4cc',
    autoHideMenuBar: true,
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
