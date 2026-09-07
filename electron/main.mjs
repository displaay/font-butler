import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, nativeImage, nativeTheme, Tray } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readApiTokenFile } from './api-token.mjs'
import { deliverNativeNotice, electronNotificationPermission } from './notify.mjs'
import {
  buildTrayMenuModel,
  menuBarUpdateBadge,
  menuBarTrayIconPath,
  outdatedFamilies,
  unreadOperationIdsToMark,
} from './updates-menu.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_API_PORT = 43182
let API = process.env.FONT_BUTLER_API ?? process.env.FONTCASE_API ?? `http://127.0.0.1:${DEFAULT_API_PORT}`
let UI =
  process.env.FONT_BUTLER_UI ??
  process.env.FONTCASE_UI ??
  (app.isPackaged ? API : 'http://127.0.0.1:43181')
const ICON_PATH = path.join(__dirname, '../build/icon.png')
const MENUBAR_ICON_PATH = path.join(__dirname, '../build/menubarTemplate.png')
const MENUBAR_ATTENTION_ICON_PATH = path.join(__dirname, '../build/menubarNotificationTemplate.svg')
const APP_ICON = fs.existsSync(ICON_PATH) ? nativeImage.createFromPath(ICON_PATH) : undefined
const TRAY_ICON_PATHS = { quiet: MENUBAR_ICON_PATH, attention: MENUBAR_ATTENTION_ICON_PATH }
const trayTemplateIcons = new Map()
const LIGHT_BACKGROUND = '#ffffff'
const DARK_BACKGROUND = '#0a0a0a'

function windowBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND
}

function applyThemeSetting(theme) {
  nativeTheme.themeSource =
    theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system'
  mainWindow?.setBackgroundColor(windowBackgroundColor())
}

let mainWindow = null
let tray = null
let apiToken = null
let catalogEntries = []
let activityOperations = []
let menuBarIconEnabled = true
let clearOfficeFontCacheEnabled = true
let clearAdobeFontCacheEnabled = true
let nativeNotificationsEnabled = false
let lastNoticeKey = ''
let lastNoticeAt = 0
let isQuitting = false
const queuedFiles = []

function apiHeaders(extra = {}) {
  const headers = { ...extra }
  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`
  }
  return headers
}

function applyBootstrapSettings(settings) {
  if (!settings) {
    return
  }
  applyThemeSetting(settings.theme)
  applyMenuBarSetting(settings.menuBarIcon)
  applyOpenAtLogin(settings.openAtLogin)
  applyOfficeCacheSetting(settings.clearOfficeFontCache)
  applyAdobeCacheSetting(settings.clearAdobeFontCache)
  applyNativeNotificationSetting(settings.nativeNotifications)
  void persistDeniedNativeNotifications(settings.nativeNotifications)
}

async function ensureApiToken() {
  if (!apiToken) {
    apiToken = readApiTokenFile()
  }
  if (!apiToken) {
    const response = await fetch(`${API}/api/bootstrap`)
    const bootstrapBody = await response.text()
    const data = bootstrapBody ? JSON.parse(bootstrapBody) : {}
    if (data.token) {
      apiToken = data.token
    }
    if (data.settings) {
      applyBootstrapSettings(data.settings)
    }
  }
  if (!apiToken) {
    throw new Error('Could not connect to Font Buttler API.')
  }
  try {
    const response = await fetch(`${API}/api/bootstrap`, {
      headers: apiHeaders(),
    })
    const bootstrapBody = await response.text()
    const data = bootstrapBody ? JSON.parse(bootstrapBody) : {}
    if (response.ok && data.settings) {
      applyBootstrapSettings(data.settings)
    }
  } catch {
    // Token is still usable even if settings refresh fails.
  }
  return apiToken
}

async function persistDeniedNativeNotifications(wanted) {
  if (!wanted) return
  if (electronNotificationPermission(Notification) === 'granted') return
  applyNativeNotificationSetting(false)
  if (!apiToken) return
  try {
    await fetch(`${API}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ nativeNotifications: false }),
    })
  } catch {
    // Keep the in-process flag off even if the catalog write fails.
  }
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow()
  }
  const win = mainWindow
  if (!win) {
    return
  }
  if (win.isMinimized()) {
    win.restore()
  }
  win.show()
  win.focus()
}

function sendWhenReady(channel, payload) {
  showMainWindow()
  const win = mainWindow
  if (!win) {
    return
  }
  const send = () => {
    if (payload === undefined) {
      win.webContents.send(channel)
    } else {
      win.webContents.send(channel, payload)
    }
  }
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

function openSettings() {
  sendWhenReady('open-settings')
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return
  }
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 920,
    minHeight: 620,
    title: 'Font Buttler',
    icon: APP_ICON,
    backgroundColor: windowBackgroundColor(),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.loadURL(UI)
  mainWindow.on('close', (event) => {
    if (!isQuitting && menuBarIconEnabled) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function openFont(filePath) {
  try {
    const token = await ensureApiToken()
    const response = await fetch(`${API}/api/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ path: filePath }),
    })
    const rawBody = await response.text()
    let data = {}
    try {
      data = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      data = {}
    }
    if (!response.ok) {
      throw new Error(data.error || `Could not open font (HTTP ${response.status})`)
    }
  } catch (error) {
    console.error('Failed to open font', error)
    dialog.showErrorBox(
      'Could not open font',
      error instanceof Error ? error.message : 'Could not open font',
    )
  }
  showMainWindow()
}

async function clearCacheFromMenu(kind) {
  const pathByKind = {
    font: '/api/caches/font',
    office: '/api/caches/office',
    adobe: '/api/caches/adobe',
  }
  const titleByKind = {
    font: 'Remove font cache',
    office: 'Remove MS Office cache',
    adobe: 'Remove Adobe cache',
  }
  try {
    const token = await ensureApiToken()
    const url = `${API}${pathByKind[kind]}`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    })
    const rawBody = await response.text()
    let data
    try {
      data = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      if (response.status === 404) {
        throw new Error(
          'The Font Buttler API is out of date. Quit Font Buttler completely, then reopen it.',
        )
      }
      throw new Error(
        `Unexpected API response (HTTP ${response.status}): ${rawBody.slice(0, 120)}`,
      )
    }
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

function reinstallFromTray(ids) {
  if (ids.length === 0) {
    return
  }
  sendWhenReady('reinstall-fonts', { ids })
}

function openTab(tab, operationId) {
  sendWhenReady('open-tab', operationId ? { tab, operationId } : { tab })
}

function menuActionIcon(kind) {
  const svg =
    kind === 'mark-read'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="#000" d="M6.2 11.4 2.8 8l1.1-1.1 2.3 2.3 5.9-5.9 1.1 1.1z"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="#000" d="M2.5 3.5h11v1.4h-11zm0 3.8h11v1.4h-11zm0 3.8h7.5V12H2.5z"/></svg>'
  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  )
  image.setTemplateImage(true)
  return image
}

async function markAllActivityReadFromTray() {
  try {
    const token = await ensureApiToken()
    const response = await fetch(`${API}/api/activity/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: '{}',
    })
    const data = await response.json()
    if (Array.isArray(data.operations)) {
      activityOperations = data.operations
      refreshTrayMenu()
    }
  } catch (error) {
    console.error('Failed to mark activity as read', error)
  }
}

async function markActivityUnreadFromMain(ids) {
  if (ids.length === 0) {
    return
  }
  try {
    const token = await ensureApiToken()
    const response = await fetch(`${API}/api/activity/unread`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ids }),
    })
    const data = await response.json()
    if (Array.isArray(data.operations)) {
      activityOperations = data.operations
      refreshTrayMenu()
    }
  } catch (error) {
    console.error('Failed to mark activity as unread', error)
  }
}

function buildTrayMenu() {
  const families = outdatedFamilies(catalogEntries)
  const model = buildTrayMenuModel({ operations: activityOperations, families })
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const items = []
  items.push({ label: model.activityHeadline, enabled: false })
  if (model.activityEmpty) {
    items.push({ label: 'No activity', enabled: false })
  } else {
    for (const row of model.activityRows) {
      items.push({
        label: row.unread ? `• ${row.label}` : row.label,
        click: () => {
          openTab('activity', row.id)
        },
      })
    }
  }
  if (model.activityShowAll) {
    items.push({
      label: 'Show all',
      icon: menuActionIcon('show-all'),
      click: () => {
        openTab('activity')
      },
    })
  }
  if (model.markAllAsRead) {
    items.push({
      label: 'Mark all as read',
      icon: menuActionIcon('mark-read'),
      click: () => {
        void markAllActivityReadFromTray()
      },
    })
  }
  items.push({ type: 'separator' })
  items.push({ label: model.updatesHeadline, enabled: false })
  if (model.updatesEmpty) {
    items.push({ label: 'No source updates', enabled: false })
  } else {
    for (const family of model.updateRows) {
      items.push({
        label: family.name,
        click: () => {
          reinstallFromTray(family.ids)
        },
      })
    }
  }
  if (model.updatesShowAll) {
    items.push({
      label: 'Show all',
      icon: menuActionIcon('show-all'),
      click: () => {
        openTab('updates')
      },
    })
  }
  const allIds = families.flatMap((family) => family.ids)
  items.push({
    label: 'Reinstall all fonts',
    enabled: allIds.length > 0,
    click: () => {
      reinstallFromTray(allIds)
    },
  })
  items.push({ type: 'separator' })
  items.push({
    label: 'Remove font cache',
    click: () => {
      void clearCacheFromMenu('font')
    },
  })
  items.push({
    label: 'Remove MS Office cache',
    enabled: clearOfficeFontCacheEnabled,
    click: () => {
      void clearCacheFromMenu('office')
    },
  })
  items.push({
    label: 'Remove Adobe cache',
    enabled: clearAdobeFontCacheEnabled,
    click: () => {
      void clearCacheFromMenu('adobe')
    },
  })
  items.push({ type: 'separator' })
  items.push({ role: 'quit' })
  return Menu.buildFromTemplate(items)
}

function refreshTrayMenu() {
  if (!tray) {
    return
  }
  const families = outdatedFamilies(catalogEntries)
  const model = buildTrayMenuModel({ operations: activityOperations, families })
  const tooltip = model.hasUnread
    ? model.hasUpdates
      ? 'Font Buttler — unread activity and updates'
      : 'Font Buttler — unread activity'
    : model.hasUpdates
      ? `Font Buttler — ${families.length} updates`
      : 'Font Buttler'
  tray.setToolTip(tooltip)
  const icon = trayTemplateIcon({ hasUnread: model.hasUnread, hasUpdates: model.hasUpdates })
  if (icon) {
    tray.setImage(icon)
  }
  tray.setTitle(menuBarUpdateBadge({ hasUnread: model.hasUnread, hasUpdates: model.hasUpdates }))
  tray.setContextMenu(buildTrayMenu())
}

function destroyTray() {
  tray?.destroy()
  tray = null
}

function loadTrayTemplateIcon(iconPath) {
  const cached = trayTemplateIcons.get(iconPath)
  if (cached) {
    return cached
  }
  if (!fs.existsSync(iconPath)) {
    return null
  }
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty() && iconPath.endsWith('.svg')) {
    const svg = fs.readFileSync(iconPath, 'utf8')
    image = nativeImage.createFromDataURL(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    )
  }
  if (image.isEmpty()) {
    return null
  }
  image.setTemplateImage(true)
  trayTemplateIcons.set(iconPath, image)
  return image
}

function trayTemplateIcon(attention) {
  const iconPath = menuBarTrayIconPath(attention, TRAY_ICON_PATHS)
  return loadTrayTemplateIcon(iconPath) ?? loadTrayTemplateIcon(MENUBAR_ICON_PATH)
}

function ensureTray() {
  if (!menuBarIconEnabled) {
    destroyTray()
    return
  }
  if (tray) {
    refreshTrayMenu()
    return
  }
  const icon = trayTemplateIcon({
    hasUnread: activityOperations.some((operation) => operation.unread),
    hasUpdates: outdatedFamilies(catalogEntries).length > 0,
  })
  if (!icon) {
    return
  }
  tray = new Tray(icon)
  tray.setIgnoreDoubleClickEvents(true)
  refreshTrayMenu()
}

function applyOfficeCacheSetting(enabled) {
  const next = enabled !== false
  if (clearOfficeFontCacheEnabled === next) {
    return
  }
  clearOfficeFontCacheEnabled = next
  Menu.setApplicationMenu(buildAppMenu())
  refreshTrayMenu()
}

function applyNativeNotificationSetting(enabled) {
  nativeNotificationsEnabled = enabled === true
}

function windowIsHidden() {
  if (!mainWindow || mainWindow.isDestroyed()) return true
  return !mainWindow.isVisible() || mainWindow.isMinimized()
}

function maybeNotify(notice) {
  const now = Date.now()
  const result = deliverNativeNotice({
    notice,
    enabled: nativeNotificationsEnabled,
    windowHidden: windowIsHidden(),
    lastKey: lastNoticeKey,
    lastAt: lastNoticeAt,
    now,
    createNotification(options) {
      const n = new Notification(options)
      n.on('click', () => {
        showMainWindow()
      })
      return n
    },
  })
  lastNoticeKey = result.lastKey
  lastNoticeAt = result.lastAt
}

function applyAdobeCacheSetting(enabled) {
  const next = enabled !== false
  if (clearAdobeFontCacheEnabled === next) {
    return
  }
  clearAdobeFontCacheEnabled = next
  Menu.setApplicationMenu(buildAppMenu())
  refreshTrayMenu()
}

function applyOpenAtLogin(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled === true,
  })
}

function applyMenuBarSetting(enabled) {
  const next = enabled !== false
  const turningOff = menuBarIconEnabled && !next
  menuBarIconEnabled = next
  if (next) {
    ensureTray()
    return
  }
  destroyTray()
  if (turningOff && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    showMainWindow()
  }
}

function handleApiEvent(event) {
  if (!event || typeof event !== 'object') {
    return
  }
  if (event.type === 'catalog' && Array.isArray(event.entries)) {
    catalogEntries = event.entries
    refreshTrayMenu()
  }
  if (event.type === 'operations' && Array.isArray(event.operations)) {
    const previous = activityOperations
    activityOperations = event.operations
    const ids = unreadOperationIdsToMark({
      previous,
      next: event.operations,
      foregroundBusy: false,
      windowHidden: windowIsHidden(),
      markVisibleBackground: false,
    })
    if (ids.length > 0) {
      activityOperations = activityOperations.map((operation) =>
        ids.includes(operation.id) ? { ...operation, unread: true } : operation,
      )
      void markActivityUnreadFromMain(ids)
    }
    refreshTrayMenu()
  }
  if (event.type === 'settings' && event.settings) {
    applyThemeSetting(event.settings.theme)
    applyMenuBarSetting(event.settings.menuBarIcon)
    applyOpenAtLogin(event.settings.openAtLogin)
    applyOfficeCacheSetting(event.settings.clearOfficeFontCache)
    applyAdobeCacheSetting(event.settings.clearAdobeFontCache)
    applyNativeNotificationSetting(event.settings.nativeNotifications)
  }
  if (event.type === 'notice' && event.notice) {
    maybeNotify(event.notice)
  }
}

async function loadCatalog() {
  try {
    const token = await ensureApiToken()
    const response = await fetch(`${API}/api/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json()
    if (Array.isArray(data.entries)) {
      catalogEntries = data.entries
      refreshTrayMenu()
    }
  } catch (error) {
    console.error('Failed to load catalog for menu bar', error)
  }
}

async function loadActivity() {
  try {
    const token = await ensureApiToken()
    const response = await fetch(`${API}/api/activity`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json()
    if (Array.isArray(data.operations)) {
      activityOperations = data.operations
      refreshTrayMenu()
    }
  } catch (error) {
    console.error('Failed to load activity for menu bar', error)
  }
}

async function listenForApiEvents() {
  while (!isQuitting) {
    try {
      const token = await ensureApiToken()
      const response = await fetch(`${API}/api/events`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok || !response.body) {
        throw new Error('events unavailable')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!isQuitting) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((item) => item.startsWith('data:'))
          if (!line) continue
          try {
            handleApiEvent(JSON.parse(line.slice(5).trim()))
          } catch {
            // ignore malformed SSE
          }
        }
      }
    } catch {
      if (isQuitting) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
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
          enabled: clearOfficeFontCacheEnabled,
          click: () => {
            void clearCacheFromMenu('office')
          },
        },
        {
          label: 'Remove Adobe cache',
          enabled: clearAdobeFontCacheEnabled,
          click: () => {
            void clearCacheFromMenu('adobe')
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
    showMainWindow()
  })

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (app.isReady()) {
      void openFont(filePath)
    } else {
      queuedFiles.push(filePath)
    }
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  async function startPackagedBackend() {
    if (!app.isPackaged) {
      return
    }
    const staticDir = path.join(__dirname, '../dist')
    const { startFontButlerServer } = await import('./server.bundle.mjs')
    const preferred = Number(new URL(API).port || DEFAULT_API_PORT)
    let lastError
    for (let port = preferred; port < preferred + 20; port += 1) {
      try {
        const info = await startFontButlerServer({ staticDir, port })
        API = `http://127.0.0.1:${info.port}`
        if (info.token) {
          apiToken = info.token
        }
        if (!process.env.FONT_BUTLER_UI && !process.env.FONTCASE_UI) {
          UI = API
        }
        return
      } catch (error) {
        lastError = error
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
          continue
        }
        throw error
      }
    }
    throw lastError
  }

  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.dock && APP_ICON && !APP_ICON.isEmpty() && !app.isPackaged) {
      app.dock.setIcon(APP_ICON)
    }
    Menu.setApplicationMenu(buildAppMenu())
    nativeTheme.on('updated', () => {
      mainWindow?.setBackgroundColor(windowBackgroundColor())
    })
    try {
      await startPackagedBackend()
      await ensureApiToken()
    } catch (error) {
      console.error('Could not bootstrap Font Buttler API', error)
    }
    ensureTray()
    createWindow()
    void loadCatalog()
    void loadActivity()
    void listenForApiEvents()
    const fromArgv = process.argv.filter((arg) =>
      /\.(ttf|otf|ttc|otc|woff2?)$/i.test(arg),
    )
    for (const filePath of [...queuedFiles, ...fromArgv]) {
      await openFont(filePath)
    }
    queuedFiles.length = 0
  })

  app.on('window-all-closed', () => {
    if (menuBarIconEnabled) {
      return
    }
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    showMainWindow()
  })
}

ipcMain.handle('get-api-token', async () => {
  try {
    return await ensureApiToken()
  } catch {
    return null
  }
})

ipcMain.handle('request-notifications', () => electronNotificationPermission(Notification))

ipcMain.handle('pick-file', async () => {
  const options = {
    title: 'Locate source',
    properties: ['openFile'],
    filters: [
      { name: 'Fonts', extensions: ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2'] },
    ],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled) {
    return null
  }
  return result.filePaths[0] ?? null
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
