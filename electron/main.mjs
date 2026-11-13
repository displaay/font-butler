import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
  utilityProcess,
} from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readApiTokenFile } from './api-token.mjs'
import {
  APP_FOLDER_NAME,
  MIGRATION_DATA_ROOT_ENV,
  MIGRATION_HANDLED_ENV,
  MIGRATION_STALL_ENV,
  launchAfterMigrationFailure,
  legacyOwnerBlockMessage,
  committedLeftoverDirectories,
  migrateLegacyMacAppDirs,
  migrationAnnouncementFlags,
  shouldMigrateRealMacLibrary,
} from './mac-data-migration.mjs'
import { isAllowedAppUpdateUrl, trayTooltip } from './app-update.mjs'
import {
  cleanupOpenedUpdateDmgs,
  createAppUpdateInstaller,
  detectAppUpdateRuntime,
  openedUpdateDmgRecordFile,
  outermostAppBundle,
  readAppTestFeedMarker,
} from './app-update-install.mjs'
import { createDocumentAppObserver } from './document-app-watch.mjs'
import { createDocumentOpenWatch, documentWatchIpc } from './document-open-watch.mjs'
import { createExternalFontOpenNotifier } from './external-font-open-notify.mjs'
import { createAnnouncementSlot } from './announcement-delivery.mjs'
import { dismissAnnouncement, presentPendingAnnouncement } from './announcements.mjs'
import { applyTestFeedDataIsolation } from './test-feed-data.mjs'
import { macosDockIconPng } from './dock-icon.mjs'
import { createLoginItemApplier } from './login-item.mjs'
import {
  collectFinderFontPaths,
  createFinderJobQueue,
  destinationChoices,
  familyNamePromptScript,
  finderInstallIssues,
  compareLaunchArgv,
  finderCompareArgv,
  FINDER_COMPARE,
  FINDER_INSTALL_AS,
  FINDER_LINK_TO,
  formatFinderInstallIssues,
  groupIdsByFormat,
  idsEligibleForFinderInstall,
  suggestedFamilyName,
} from './finder-install.mjs'
import {
  FINDER_SYNC_AGENT_DISABLED,
  FINDER_SYNC_SETTINGS_URL,
  FINDER_SYNC_TOO_MANY_FILES,
  commitFinderSyncAgentRegistration,
  consumeFinderSyncPendingErrorFiles,
  finderSyncAgentBundleProgram,
  finderSyncPendingErrorConsumePaths,
  finderSyncRequestSeen,
  finderSyncWireAction,
  formatFinderSyncRejections,
  noteFinderSyncRequest,
  readFinderSyncAgentRecord,
  finderSyncProductDisplayName,
  claimSameExecutableInstance,
  releaseSameExecutableInstance,
  sameExecutableLockPath,
  sharedLibraryLaunchMode,
  routeFinderSyncError,
  refreshFinderSyncRegistration,
  readFinderSyncFiles,
  scanFinderSyncSelection,
} from './finder-sync.mjs'
import { deliverNativeNotice, electronNotificationPermission } from './notify.mjs'
import {
  LOGOUT_CANCELLED,
  logoutFailedDialogOptions,
  logoutProbeWouldStartDialogOptions,
  logoutRequestFollowUp,
  menuLogoutPathAfterCacheClear,
  presentLogoutFailure,
  presentLogoutNotice,
  showLogoutMessageBox,
} from './logout-dialog.mjs'
import { createWatchNoticeBuffer, isWatchFailureNotice } from './watch-notices.mjs'
import {
  buildTrayMenuModel,
  menuBarUpdateBadge,
  menuBarTrayIconPath,
  outdatedFamilies,
  unreadOperationIdsToMark,
} from './updates-menu.mjs'
import {
  applyMainWindowClosed,
  applyWindowShown,
  otherAppWindowNeedsDock,
  shouldQuitOnWindowAllClosed,
  shouldShowDockOnWindowShow,
} from './window-lifecycle.mjs'
import {
  bootstrapErrorPageHtml,
  canRetryPackagedBootstrap,
  detachWindowLifecycleHandlers,
  formatBootstrapFailureMessage,
  shouldIgnoreShowMainWindowDuringBootstrap,
  shouldRetryBootstrapOnActivate,
  shouldTreatRenderProcessGoneAsCrash,
  startingPageHtml,
  BOOTSTRAP_ERROR_WINDOW_KIND,
  BOOTSTRAP_STARTING_WINDOW_KIND,
} from './bootstrap-window.mjs'
import { showDebugConsole, getDebugConsoleWindow } from './debug-console.mjs'
import {
  attachDebugLogPersistence,
  createDebugLogFileWriter,
  createDebugLogStore,
  defaultLogFilePath,
} from './debug-log.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Before requestSingleInstanceLock and before app ready. Only the packaged
// fontButlerTestFeed marker selects this. A LaunchServices relaunch has no
// environment, so the marker alone has to isolate the test build. A marked
// build must not move the real library.
const testFeedPlan = applyTestFeedDataIsolation(app)

// 0.4.0 pinned userData at Font Buttler. This release uses Cuttler and moves
// the old folders on first launch. Must run before ready, and before Electron
// creates the Cuttler userData directory.
let macDataMigration = null
/** Essential path rewrite did not finish. Do not open the library this launch. */
let migrationFailure = null
const canSetUserData = typeof app.isReady !== 'function' || !app.isReady()
if (
  canSetUserData &&
  shouldMigrateRealMacLibrary({
    platform: process.platform,
    testFeed: testFeedPlan?.isolate === true,
  })
) {
  try {
    macDataMigration = migrateLegacyMacAppDirs(app.getPath('home'))
    // Only a finished move skips the worker. A throw must not open the
    // library on stale paths; the next launch retries the pending rewrite.
    // A live legacy owner is not finished: the next launch moves once it quits.
    if (!macDataMigration?.blockedByOwner && !macDataMigration?.runningInstanceDataDir) {
      process.env[MIGRATION_HANDLED_ENV] = '1'
    }
  } catch (error) {
    delete process.env[MIGRATION_HANDLED_ENV]
    migrationFailure = launchAfterMigrationFailure(app.getPath('home'))
    if (migrationFailure.stalled && migrationFailure.stalledDataDir) {
      macDataMigration = {
        stalled: true,
        stalledDataDir: migrationFailure.stalledDataDir,
        dataRoot: migrationFailure.dataRoot || path.join(app.getPath('appData'), APP_FOLDER_NAME),
        installDir: migrationFailure.installDir,
        movedData: false,
        movedFonts: false,
        dataOccupied: true,
        fontsOccupied: false,
      }
    }
    console.error('Could not migrate library folders', error)
  }
}
// The previous app's SingletonLock is not this process's userData lock.
// Leave both libraries untouched and do not create the Cuttler folder.
if (macDataMigration?.blockedByOwner) {
  const message = legacyOwnerBlockMessage(macDataMigration)
  console.error(message)
  try {
    dialog.showErrorBox('Quit Cuttler first', message)
  } catch (error) {
    console.error('Could not show the library-in-use message', error)
  }
  app.exit(0)
  // app.exit before ready can return. Do not fall through into setPath,
  // which would create an empty Cuttler library beside the one still in use.
  process.exit(0)
}
if (testFeedPlan?.isolate !== true && canSetUserData) {
  const runningRoot = macDataMigration?.runningInstanceDataDir || ''
  const stalledRoot =
    !runningRoot && macDataMigration?.stalled && macDataMigration.stalledDataDir
      ? macDataMigration.stalledDataDir
      : ''
  if (stalledRoot) {
    process.env[MIGRATION_STALL_ENV] = '1'
    process.env[MIGRATION_DATA_ROOT_ENV] = stalledRoot
  }
  app.setPath(
    'userData',
    runningRoot || stalledRoot || path.join(app.getPath('appData'), APP_FOLDER_NAME),
  )
}

const debugLog = createDebugLogStore()
let debugLogFilePath = defaultLogFilePath()

function openDebugConsole() {
  showDockIcon()
  showDebugConsole({
    dirname: __dirname,
    onFirstOpen(win) {
      win.on('closed', () => {
        hideDockIconIfNoAppWindowNeedsIt(win)
      })
    },
  })
}

function emitDebugLogUi(line) {
  const win = getDebugConsoleWindow()
  if (!win || win.isDestroyed()) return
  if (line === null) {
    win.webContents.send('debug-log:cleared')
    return
  }
  win.webContents.send('debug-log:line', line)
}

debugLog.subscribe((line) => {
  emitDebugLogUi(line)
})

function registerDebugLogSecrets() {
  const values = [apiToken, readApiTokenFile()].filter(Boolean)
  debugLog.registerSecrets(values)
}

function logDebug(source, message) {
  return debugLog.append(source, message)
}

function logDebugMultiline(source, text) {
  for (const part of String(text).split(/\r?\n/)) {
    const trimmed = part.trimEnd()
    if (trimmed) logDebug(source, trimmed)
  }
}

process.on('uncaughtException', (error) => {
  console.error(error)
  logDebug('main', error instanceof Error ? error.stack ?? error.message : String(error))
})

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection', reason)
  logDebug(
    'main',
    reason instanceof Error ? reason.stack ?? reason.message : String(reason),
  )
})
const DEFAULT_API_PORT = 43182
let API = process.env.FONT_BUTLER_API ?? process.env.FONTCASE_API ?? `http://127.0.0.1:${DEFAULT_API_PORT}`
let UI =
  process.env.FONT_BUTLER_UI ??
  process.env.FONTCASE_UI ??
  (app.isPackaged ? API : 'http://127.0.0.1:43181')

const API_ENDPOINT_FILE = 'api-endpoint.json'
let receiverOwnerWatchTimer = null

function apiEndpointFilePath() {
  try {
    return path.join(app.getPath('userData'), API_ENDPOINT_FILE)
  } catch {
    return ''
  }
}

function publishApiEndpoint(url = API) {
  const file = apiEndpointFilePath()
  if (!file || typeof url !== 'string' || !url.startsWith('http')) return
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ url, updatedAt: Date.now() }))
  } catch (error) {
    console.error('Could not publish API endpoint for Finder Sync receivers', error)
  }
}

function readPublishedApiEndpoint() {
  const file = apiEndpointFilePath()
  if (!file) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const url = typeof parsed?.url === 'string' ? parsed.url.trim() : ''
    return url.startsWith('http') ? url : null
  } catch {
    return null
  }
}

function adoptPublishedApiEndpoint() {
  const published = readPublishedApiEndpoint()
  if (!published || published === API) return Boolean(published)
  API = published
  if (!process.env.FONT_BUTLER_UI && !process.env.FONTCASE_UI) UI = API
  return true
}
const ICON_PATH = path.join(__dirname, '../build/icon.png')
const MENUBAR_ICON_PATH = path.join(__dirname, '../build/menubarTemplate.png')
const MENUBAR_ATTENTION_ICON_PATH = path.join(__dirname, '../build/menubarNotificationTemplate.svg')
const APP_ICON = fs.existsSync(ICON_PATH) ? nativeImage.createFromPath(ICON_PATH) : undefined
const trayTemplateIcons = new Map()
const dockIcons = new Map()
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

function parseAppIconStyle(value) {
  // Keep in sync with shared/appIcon.ts. classic stays the default.
  return value === 'bright' || value === 'mono' || value === 'cuttler' ? value : 'classic'
}

function iconPackDir(style) {
  return path.join(__dirname, '../build/icons', parseAppIconStyle(style))
}

function trayIconPaths() {
  // 'classic' has no icon pack: build/icons/classic does not exist, so the
  // existsSync checks below fall back to the original bundled icons.
  const quiet = path.join(iconPackDir(appIconStyle), 'tray.png')
  return {
    quiet: fs.existsSync(quiet) ? quiet : MENUBAR_ICON_PATH,
    attention: MENUBAR_ATTENTION_ICON_PATH,
  }
}

function dockIconImage(file) {
  if (!file || !fs.existsSync(file)) return null
  const cached = dockIcons.get(file)
  if (cached) return cached
  let image
  try {
    image = nativeImage.createFromBuffer(macosDockIconPng(fs.readFileSync(file)))
  } catch (error) {
    console.error('Could not shape dock icon', error)
    image = nativeImage.createFromPath(file)
  }
  if (!image || image.isEmpty()) {
    image = nativeImage.createFromPath(file)
  }
  if (!image || image.isEmpty()) return null
  dockIcons.set(file, image)
  return image
}

function applyDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) {
    return
  }
  const styled = path.join(iconPackDir(appIconStyle), 'app.png')
  const image = dockIconImage(styled) ?? dockIconImage(ICON_PATH)
  if (image) {
    app.dock.setIcon(image)
  }
}

function showDockIcon() {
  const shown = applyWindowShown({ platform: process.platform, dock: app.dock })
  if (!shouldShowDockOnWindowShow({ platform: process.platform })) return
  const paint = () => applyDockIcon()
  if (shown && typeof shown.then === 'function') void shown.then(paint, paint)
  else paint()
}

function hideDockIconIfNoAppWindowNeedsIt(closingWindow) {
  applyMainWindowClosed({
    isQuitting,
    platform: process.platform,
    menuBarIconEnabled: menuBarIconEnabled && Boolean(tray),
    otherVisibleWindow: otherAppWindowNeedsDock(BrowserWindow.getAllWindows(), closingWindow),
    dock: app.dock,
  })
}

function applyAppIconSetting(style) {
  appIconStyle = parseAppIconStyle(style)
  applyDockIcon()
  refreshTrayMenu()
}

let mainWindow = null
/** @type {boolean} Packaged app: true only after API worker + token are ready. Dev: true after bootstrap attempt. */
let apiBootstrapReady = false
/** @type {Error | null} */
let lastBootstrapError = null
/** @type {boolean} */
let bootstrapping = false
/** @type {null | typeof BOOTSTRAP_ERROR_WINDOW_KIND | typeof BOOTSTRAP_STARTING_WINDOW_KIND | 'main'} */
let mainWindowKind = null
let apiWorkerLogTail = ''
let tray = null
let apiToken = null
let apiChild = null
/** When true, worker exit after listen is an init failure — do not auto-restart. */
let workerInitFailed = false
let catalogEntries = []
let activityOperations = []
let menuBarIconEnabled = true
let appIconStyle = 'classic'
let clearOfficeFontCacheEnabled = true
let clearAdobeFontCacheEnabled = true
let nativeNotificationsEnabled = false
let lastNoticeKey = ''
let lastNoticeAt = 0
const watchNoticeBuffer = createWatchNoticeBuffer()
let isQuitting = false
let sessionReleaseOnQuitStarted = false
const queuedFiles = []
const finderJobs = createFinderJobQueue((action, filePaths, job) => runFinderJob(action, filePaths, job))
/** @type {null | { updateAvailable?: boolean, latestVersion?: string, htmlUrl?: string | null, releaseNotes?: string | null }} */
let appUpdate = null
const APP_UPDATE_POLL_MS = 6 * 60 * 60 * 1000
// The retail interval is a user setting, so this only decides how often we re-read it. The tick is a
// no-op unless the collection is on and a check is actually due.
const RETAIL_TICK_MS = 60 * 1000
let retailStatus = null
/** @type {null | (() => Promise<boolean>)} */
let runPackagedBootstrap = null
/** Held until the renderer pulls it and later acknowledges the dismiss. */
const announcementSlot = createAnnouncementSlot()
announcementSlot.onShow((announcement) => {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  win.webContents.send('announcement:show', announcement)
})

function stageLaunchAnnouncement() {
  try {
    const migrationNotice = migrationAnnouncementFlags(macDataMigration)
    announcementSlot.stage(presentPendingAnnouncement({
      userDataDir: app.getPath('userData'),
      currentVersion: app.getVersion(),
      migrationStalled: migrationNotice.migrationStalled,
      migrationLeftover: migrationNotice.migrationLeftover,
      migration: macDataMigration,
    }))
  } catch (error) {
    console.error('Could not present announcement', error)
  }
}

function startMainUiAfterBootstrap() {
  void listenForApiEvents()
  createWindow()
  void loadCatalog()
  void loadActivity()
  void loadAppUpdate()
  void loadRetailStatus()
  stageLaunchAnnouncement()
}

async function stopPackagedApiWorker() {
  if (!apiChild) return
  const child = apiChild
  apiChild = null
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(undefined)
    })
    try {
      child.kill()
    } catch {
      clearTimeout(timer)
      resolve(undefined)
    }
  })
}

async function retryPackagedBootstrap() {
  if (
    !canRetryPackagedBootstrap({
      isPackaged: app.isPackaged,
      bootstrapping,
      hasBootstrapRunner: Boolean(runPackagedBootstrap),
    })
  ) {
    return false
  }
  await stopPackagedApiWorker()
  workerInitFailed = false
  const ok = await runPackagedBootstrap({ suppressFailureUi: true })
  ensureTray()
  if (ok) {
    destroyMainWindowForReplace()
    startMainUiAfterBootstrap()
    showMainWindow()
    return true
  }
  if (lastBootstrapError) {
    await showBootstrapFailure(lastBootstrapError)
  }
  return false
}

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
  applyAppIconSetting(settings.appIcon)
  applyMenuBarSetting(settings.menuBarIcon)
  applyOpenAtLogin(settings.openAtLogin)
  applyOfficeCacheSetting(settings.clearOfficeFontCache)
  applyAdobeCacheSetting(settings.clearAdobeFontCache)
  applyNativeNotificationSetting(settings.nativeNotifications)
  applyDocumentOpenWatchSetting(settings.watchDocumentOpens)
  void persistDeniedNativeNotifications(settings.nativeNotifications)
}

function bootstrapFetchInit() {
  return { signal: AbortSignal.timeout(10_000) }
}

async function waitForWorkerCatalogOrFailure() {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const response = await fetch(`${API}/api/health`, bootstrapFetchInit())
    const data = await response.json()
    if (data.phase === 'failed' || (data.error && !data.catalogReady)) {
      workerInitFailed = true
      throw new Error(data.error || 'Cuttler service init failed')
    }
    if (data.catalogReady) {
      workerInitFailed = false
      return data
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error('Cuttler API worker did not load the catalog in time')
}

async function ensureApiToken() {
  if (!apiToken) {
    apiToken = readApiTokenFile()
  }
  if (!apiToken) {
    const response = await fetch(`${API}/api/bootstrap`, bootstrapFetchInit())
    const bootstrapBody = await response.text()
    const data = bootstrapBody ? JSON.parse(bootstrapBody) : {}
    if (data.token) {
      apiToken = data.token
    }
    if (data.settings && !receiverOnly) {
      applyBootstrapSettings(data.settings)
    }
  }
  if (!apiToken) {
    throw new Error('Could not connect to Cuttler API.')
  }
  registerDebugLogSecrets()
  try {
    const response = await fetch(`${API}/api/bootstrap`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(10_000),
    })
    const bootstrapBody = await response.text()
    const data = bootstrapBody ? JSON.parse(bootstrapBody) : {}
    if (response.ok && data.settings && !receiverOnly) {
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

function catalogJsonPathHint() {
  return path.join(app.getPath('userData'), 'catalog.json')
}

function dataDirPathHint() {
  return app.getPath('userData')
}

function bootstrapFailureMessage(error) {
  return formatBootstrapFailureMessage(error, {
    stderrTail: apiWorkerLogTail,
    dataDir: dataDirPathHint(),
    catalogPath: catalogJsonPathHint(),
  })
}

function destroyMainWindowForReplace() {
  watchNoticeBuffer.markNotReady()
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = null
    mainWindowKind = null
    return
  }
  const win = mainWindow
  mainWindow = null
  mainWindowKind = null
  detachWindowLifecycleHandlers(win)
  win.destroy()
}

function deliverWatchNotices(notices) {
  if (!notices?.length) return
  const win = mainWindow
  if (!win || win.isDestroyed() || mainWindowKind !== 'main') {
    watchNoticeBuffer.requeue(notices)
    return
  }
  win.webContents.send('watch-notices', notices)
}

function flushWatchNotices() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindowKind !== 'main') return
  deliverWatchNotices(watchNoticeBuffer.markReady())
}

function attachMainWindowHandlers(win) {
  win.webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    watchNoticeBuffer.markNotReady()
  })
  win.webContents.on('did-finish-load', () => {
    if (win !== mainWindow || mainWindowKind !== 'main') return
    flushWatchNotices()
  })
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return
    const levelLabel = level === 2 ? 'warn' : 'error'
    logDebug('renderer', `[${levelLabel}] ${message} (${sourceId}:${line})`)
  })
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (code === -3) return
    console.error('Window failed to load', code, description, url)
    logDebug('window', `did-fail-load ${code} ${description} ${url}`)
    void showLoadFailurePage(win, `Could not load the window (${description}).`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    logDebug('window', `render-process-gone ${details.reason} exitCode=${details.exitCode}`)
    if (!shouldTreatRenderProcessGoneAsCrash(details)) {
      return
    }
    console.error('Renderer exited', details)
    void showLoadFailurePage(win, `The window crashed (${details.reason}).`)
  })
  win.on('unresponsive', () => {
    console.error('Window became unresponsive')
    logDebug('window', 'Window became unresponsive')
  })
}

async function showLoadFailurePage(win, detail) {
  if (!win || win.isDestroyed()) return
  watchNoticeBuffer.markNotReady()
  mainWindowKind = BOOTSTRAP_ERROR_WINDOW_KIND
  const message = `${detail}\n\nTry Quit from the menu, or use Retry after the font service is running.`
  const html = bootstrapErrorPageHtml(message, { dark: nativeTheme.shouldUseDarkColors })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

function createBootstrapShellWindow(kind) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindowKind === 'main') {
    return
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    showDockIcon()
    mainWindow.show()
    mainWindow.focus()
    return
  }
  showDockIcon()
  mainWindow = new BrowserWindow({
    width: kind === BOOTSTRAP_STARTING_WINDOW_KIND ? 420 : 560,
    height: kind === BOOTSTRAP_STARTING_WINDOW_KIND ? 220 : 480,
    minWidth: 320,
    minHeight: 180,
    title: 'Cuttler',
    icon: APP_ICON,
    backgroundColor: windowBackgroundColor(),
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindowKind = kind
  attachMainWindowHandlers(mainWindow)
  const dark = nativeTheme.shouldUseDarkColors
  const html =
    kind === BOOTSTRAP_STARTING_WINDOW_KIND
      ? startingPageHtml({ dark })
      : bootstrapErrorPageHtml('Starting…', { dark })
  void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  mainWindow.on('closed', () => {
    if (mainWindowKind !== 'main') {
      mainWindow = null
      mainWindowKind = null
    }
  })
}

function createBootstrapErrorWindow(message) {
  destroyMainWindowForReplace()
  showDockIcon()
  mainWindow = new BrowserWindow({
    width: 560,
    height: 480,
    minWidth: 400,
    minHeight: 320,
    title: 'Cuttler',
    icon: APP_ICON,
    backgroundColor: windowBackgroundColor(),
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const win = mainWindow
  mainWindowKind = BOOTSTRAP_ERROR_WINDOW_KIND
  attachMainWindowHandlers(win)
  const html = bootstrapErrorPageHtml(message, { dark: nativeTheme.shouldUseDarkColors })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.on('closed', () => {
    if (mainWindow !== win) return
    if (!isQuitting && mainWindowKind === BOOTSTRAP_ERROR_WINDOW_KIND) {
      isQuitting = true
      app.quit()
    }
    mainWindow = null
    mainWindowKind = null
  })
}

async function promptBootstrapRecovery(error) {
  const message = bootstrapFailureMessage(error)
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const options = {
    type: 'error',
    title: 'Cuttler could not start',
    message: 'The local font service is not available.',
    detail: message,
    buttons: ['Retry', 'Quit', 'Open troubleshooting'],
    defaultId: 0,
    cancelId: 2,
  }
  const choice = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  if (choice.response === 0) {
    return 'retry'
  }
  if (choice.response === 1) {
    isQuitting = true
    app.quit()
    return 'quit'
  }
  if (choice.response === 2) {
    await shell.openExternal(
      'https://github.com/displaay/font-butler/blob/main/docs/troubleshooting-blank-window.md',
    )
    return 'docs'
  }
  return 'cancel'
}

async function showBootstrapFailure(error) {
  bootstrapping = false
  lastBootstrapError = error instanceof Error ? error : new Error(String(error))
  logDebug('bootstrap', bootstrapFailureMessage(lastBootstrapError))
  while (!isQuitting && !apiBootstrapReady) {
    createBootstrapErrorWindow(bootstrapFailureMessage(lastBootstrapError))
    const action = await promptBootstrapRecovery(lastBootstrapError)
    if (action === 'retry') {
      if (await retryPackagedBootstrap()) return
      continue
    }
    return
  }
}

function showStartingWindowIfNeeded() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showDockIcon()
    mainWindow.show()
    mainWindow.focus()
    return
  }
  createBootstrapShellWindow(BOOTSTRAP_STARTING_WINDOW_KIND)
}

function showMainWindow() {
  if (receiverOnly) return
  showDockIcon()
  if (
    shouldIgnoreShowMainWindowDuringBootstrap({
      isPackaged: app.isPackaged,
      bootstrapping,
      apiBootstrapReady,
    })
  ) {
    showStartingWindowIfNeeded()
    return
  }
  if (
    shouldRetryBootstrapOnActivate({
      isPackaged: app.isPackaged,
      apiBootstrapReady,
      bootstrapping,
      lastBootstrapError,
    })
  ) {
    void retryPackagedBootstrap('activate')
    return
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindowKind !== 'main') {
    destroyMainWindowForReplace()
  }
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

let documentOpenWatchEnabled = false
let documentOpenWatch = null
let documentAppObserver = null

function documentWatch() {
  if (!documentOpenWatch) {
    documentOpenWatch = createDocumentOpenWatch({
      enabled: false,
      // The existing sheet runs the document font report. This watch does not activate fonts.
      parse(filePath) {
        return { path: filePath }
      },
      onEffect(effect) {
        deliverDocumentWatchEffect(effect)
      },
    })
  }
  return documentOpenWatch
}

function documentObserver() {
  if (!documentAppObserver) {
    documentAppObserver = createDocumentAppObserver({
      onOpenedPath(event) {
        documentWatch().open(event)
      },
      onInDesignFonts(event) {
        documentWatch().live(event)
      },
    })
  }
  return documentAppObserver
}

function deliverDocumentWatchEffect(effect) {
  const ipc = documentWatchIpc(effect)
  if (!ipc) return
  if (ipc.channel === 'open-document') {
    sendWhenReady('open-document', ipc.payload)
    return
  }
  deliverDocumentWatchNote(ipc.payload?.message)
}

function deliverDocumentWatchNote(message) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return
  const win = mainWindow
  const visible =
    win && !win.isDestroyed() && mainWindowKind === 'main' && win.isVisible() && !win.isMinimized()
  if (!visible) {
    sendWhenReady('document-watch-note', { message: text })
    return
  }
  win.webContents.send('document-watch-note', { message: text })
}

function applyDocumentOpenWatchSetting(enabled) {
  const next = enabled === true
  if (documentOpenWatchEnabled === next && documentOpenWatch) return
  documentOpenWatchEnabled = next
  documentWatch().setEnabled(next)
  if (next) documentObserver().start()
  else if (documentAppObserver) documentAppObserver.stop()
}

function openSettings(focus) {
  sendWhenReady('open-settings', typeof focus === 'string' ? { focus } : undefined)
}

const documentOpenOptions = {
  title: 'Open document',
  properties: ['openFile'],
  filters: [
    {
      name: 'PDF, IDML, InDesign, Illustrator, Photoshop, Word, and PowerPoint',
      extensions: ['pdf', 'idml', 'indd', 'indt', 'ai', 'psd', 'psb', 'docx', 'pptx'],
    },
  ],
}

async function pickDocumentPath() {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, documentOpenOptions)
    : await dialog.showOpenDialog(documentOpenOptions)
  if (result.canceled) return null
  return result.filePaths[0] ?? null
}

async function openDocumentFromMenu() {
  const picked = await pickDocumentPath()
  if (!picked) return
  sendWhenReady('open-document', { path: picked })
}

function openAppUpdate() {
  void loadAppUpdate(true)
  openSettings('app-update')
}

async function openExternalUrl(url) {
  if (!isAllowedAppUpdateUrl(url)) {
    return false
  }
  await shell.openExternal(url)
  return true
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindowKind !== 'main') {
      watchNoticeBuffer.markNotReady()
      void mainWindow.loadURL(UI)
      mainWindowKind = 'main'
    }
    return
  }
  if (app.isPackaged && !apiBootstrapReady) {
    return
  }
  showDockIcon()
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 920,
    minHeight: 620,
    title: 'Cuttler',
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
  mainWindowKind = 'main'
  attachMainWindowHandlers(mainWindow)
  mainWindow.loadURL(UI)
  // Allowlist includes GitHub Releases and the pinned Displaay EULA URL (`RETAIL_EULA_EXTERNAL_URL`).
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedAppUpdateUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => {
    const closedWindow = mainWindow
    mainWindow = null
    watchNoticeBuffer.markNotReady()
    hideDockIconIfNoAppWindowNeedsIt(closedWindow)
  })
}

async function postImportFiles(files) {
  const token = await ensureApiToken()
  const body = new FormData()
  const sourcePaths = []
  const sourceMtimes = []
  for (const file of files ?? []) {
    const data = file?.data
    if (!data || !file.sourcePath) continue
    body.append('files', new Blob([data]), file.filename || 'font')
    sourcePaths.push(file.sourcePath)
    sourceMtimes.push(typeof file.mtimeMs === 'number' && Number.isFinite(file.mtimeMs) ? file.mtimeMs : null)
  }
  body.append('sourcePaths', JSON.stringify(sourcePaths))
  body.append('sourceMtimes', JSON.stringify(sourceMtimes))
  const response = await fetch(`${API}/api/import-finder`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  })
  const rawBody = await response.text()
  let data = {}
  try {
    data = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    data = {}
  }
  if (!response.ok) {
    throw new Error(data.error || `Request failed (HTTP ${response.status})`)
  }
  return data
}

async function postApi(pathname, body) {
  const token = await ensureApiToken()
  const response = await fetch(`${API}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const rawBody = await response.text()
  let data = {}
  try {
    data = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    data = {}
  }
  if (!response.ok) {
    throw new Error(data.error || `Request failed (HTTP ${response.status})`)
  }
  return data
}

async function getApi(pathname) {
  await ensureApiToken()
  const response = await fetch(`${API}${pathname}`, {
    headers: apiHeaders(),
  })
  const rawBody = await response.text()
  let data = {}
  try {
    data = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    data = {}
  }
  if (!response.ok) {
    throw new Error(data.error || `Request failed (HTTP ${response.status})`)
  }
  return data
}

let externalFontOpenNotify = null

function getExternalFontOpenNotify() {
  if (!externalFontOpenNotify) {
    externalFontOpenNotify = createExternalFontOpenNotifier((payload) => {
      sendWhenReady('external-font-open', payload)
    })
  }
  return externalFontOpenNotify
}

function notifyOpenFontPending() {
  showMainWindow()
  getExternalFontOpenNotify().pending()
}

function notifyOpenFontDone() {
  getExternalFontOpenNotify().done()
}

async function openFont(filePath) {
  notifyOpenFontPending()
  try {
    await postApi('/api/open', { path: filePath })
  } catch (error) {
    console.error('Failed to open font', error)
    dialog.showErrorBox(
      'Could not open font',
      error instanceof Error ? error.message : 'Could not open font',
    )
  } finally {
    notifyOpenFontDone()
  }
}

function enqueueFinderJob(action, filePaths, options) {
  return finderJobs.enqueue(action, filePaths, options)
}

function closeFinderHandles(handles) {
  for (const handle of handles ?? []) {
    if (handle?.fd == null) continue
    try {
      fs.closeSync(handle.fd)
    } catch {
      // The descriptor is already closed.
    }
  }
}

function finderActionTitle(action) {
  if (action === FINDER_COMPARE) return 'Compare'
  return finderInstallTitle(action)
}

async function enqueueValidatedFinderInstall(action, filePaths) {
  const title = finderActionTitle(action)
  let checked
  try {
    checked = await scanFinderSyncSelection(filePaths)
  } catch (error) {
    console.error('Finder Sync selection was not checked', error)
    dialog.showErrorBox(title, 'Those files could not be checked.')
    showMainWindow()
    return false
  }
  if (checked.limitError) {
    closeFinderHandles(checked.handles)
    dialog.showErrorBox(title, checked.limitError)
    showMainWindow()
    return false
  }
  if (!Array.isArray(checked.paths) || checked.paths.length === 0) {
    closeFinderHandles(checked.handles)
    const empty = action === FINDER_COMPARE ? 'No font files in that selection.' : 'No installable font files in that selection.'
    dialog.showErrorBox(title, formatFinderSyncRejections(checked.rejected) || empty)
    showMainWindow()
    return false
  }
  if (checked.rejected?.length) {
    dialog.showErrorBox(title, formatFinderSyncRejections(checked.rejected))
  }
  const handles = Array.isArray(checked.handles) ? checked.handles : []
  enqueueFinderJob(action, checked.paths, {
    handles,
    close: () => closeFinderHandles(handles),
  })
  return true
}

function runningTestFeed() {
  return readAppTestFeedMarker(outermostAppBundle(process.execPath)) === true
}

function registerNativeFinderServices() {
  if (process.platform !== 'darwin') return false
  try {
    const addon = require('./finder-services.node')
    addon.register((action, filePaths) => {
      enqueueFinderJob(action, filePaths)
    })
    return true
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      console.error('Finder services provider is not loaded', error)
    }
    return false
  }
}

const finderSyncRequests = new Map()
const finderSyncErrorsShown = new Map()

function presentFinderSyncUserError(code) {
  const now = Date.now()
  const appPath = currentFinderSyncBundle()
  const route = routeFinderSyncError({
    code,
    appPath,
    notificationsEnabled: nativeNotificationsEnabled,
    permission: electronNotificationPermission(Notification),
    alreadyShown: finderSyncErrorsShown,
    now,
  })
  if (!route.shown) return
  finderSyncErrorsShown.set(route.code, now)
  const title = finderSyncProductDisplayName(appPath)
  if (route.channel === 'notification') {
    const notice = new Notification({ title, body: route.message })
    notice.on('click', () => showMainWindow())
    notice.show()
    return
  }
  dialog.showErrorBox(title, route.message)
}

function consumeFinderSyncPendingErrors() {
  // userData is Cuttler after a move or a fresh install, and the old folder
  // when the move stalled. The helper writes the live library. Also read the
  // other support folders so a record left by the previous helper, or written
  // beside a library this launch is not using, is shown once and deleted.
  // Test feed and FONT_BUTLER_DATA / FONTCASE_DATA stay on userData alone.
  const files = finderSyncPendingErrorConsumePaths({
    userDataDir: app.getPath('userData'),
    appSupportDir: app.getPath('appData'),
    includeOtherSupportDirs: shouldMigrateRealMacLibrary({
      platform: process.platform,
      testFeed: testFeedPlan?.isolate === true,
    }),
    // A committed copy's leftover is not the live library. Do not read or
    // delete anything inside it, including a queued Finder Sync error.
    skipDirs: committedLeftoverDirectories(app.getPath('home')),
  })
  const errors = consumeFinderSyncPendingErrorFiles(files, { appPath: currentFinderSyncBundle() })
  for (const item of errors) presentFinderSyncUserError(item.code)
}

function finderSyncAgentRecordFile() {
  return path.join(app.getPath('userData'), 'finder-sync-agent.json')
}

function loadFinderSyncAgentRecord() {
  try {
    return readFinderSyncAgentRecord(fs.readFileSync(finderSyncAgentRecordFile(), 'utf8'))
  } catch {
    return readFinderSyncAgentRecord('')
  }
}

function saveFinderSyncAgentRecord(record) {
  fs.mkdirSync(path.dirname(finderSyncAgentRecordFile()), { recursive: true })
  fs.writeFileSync(
    finderSyncAgentRecordFile(),
    JSON.stringify({
      enabled: record.enabled !== false,
      appBundlePath: record.appBundlePath || '',
      helperPath: record.helperPath || '',
      version: record.version || '',
    }),
  )
}

function parseAgentJson(raw) {
  try {
    const parsed = JSON.parse(String(raw ?? ''))
    return parsed && typeof parsed === 'object' ? parsed : { status: 'unavailable', error: 'Finder Sync agent status was not JSON.' }
  } catch {
    return { status: 'unavailable', error: 'Finder Sync agent status was not JSON.' }
  }
}

function currentFinderSyncBundle() {
  return outermostAppBundle(process.execPath) || ''
}

function loadFinderSyncReceiver() {
  try {
    return require('./finder-sync-receiver.node')
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      console.error('Finder Sync receiver is not loaded', error)
    }
    return null
  }
}

function applyFinderSyncAgentRegistration(addon, { surface = false } = {}) {
  if (!addon) return { status: 'unavailable', error: 'Finder Sync receiver is not loaded.' }
  const record = loadFinderSyncAgentRecord()
  const testFeed = runningTestFeed()
  if (record.enabled === false) {
    return parseAgentJson(addon.unregisterAgent())
  }
  const status = parseAgentJson(addon.agentStatus())
  const currentBundle = currentFinderSyncBundle()
  let result = status
  const committed = commitFinderSyncAgentRegistration({
    testFeed,
    currentBundle,
    helperPath: currentBundle ? path.join(currentBundle, finderSyncAgentBundleProgram()) : '',
    version: app.getVersion(),
    record,
    status: status.status,
    unregister() {
      addon.unregisterAgent()
    },
    register() {
      result = parseAgentJson(addon.registerAgent())
      if (result?.error) console.error('Finder Sync agent registration failed', result.error)
      return result?.status
    },
  })
  if (committed.refused) {
    console.error('Finder Sync agent registration stayed on this build', committed.plan.label)
    return status
  }
  if (committed.saved) saveFinderSyncAgentRecord(committed.record)
  if (
    surface &&
    result?.error &&
    result.status !== 'requires-approval' &&
    result.status !== 'enabled' &&
    result.status !== 'unsupported'
  ) {
    dialog.showErrorBox('Finder menu', `${result.error}\n\n${FINDER_SYNC_AGENT_DISABLED}`)
  }
  return result
}

function reportFinderSyncAgentStatus() {
  let line = 'finder-sync-agent-status {"status":"unavailable","error":"Finder Sync receiver is not loaded."}\n'
  try {
    const addon = require('./finder-sync-receiver.node')
    applyFinderSyncAgentRegistration(addon, { surface: false })
    const status = addon.agentStatus()
    line = `finder-sync-agent-status ${status}\n`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    line = `finder-sync-agent-status ${JSON.stringify({ status: 'unavailable', error: message })}\n`
  }
  fs.writeSync(1, line)
  app.exit(line.includes('"status":"enabled"') ? 0 : 1)
}

function registerFinderSyncReceiver({ surface = false, registerAgent = true } = {}) {
  if (process.platform !== 'darwin') return false
  const addon = loadFinderSyncReceiver()
  if (!addon) return false
  try {
    addon.register((payload) => {
      const userError = typeof payload?.error === 'string' ? payload.error.trim() : ''
      if (userError) {
        presentFinderSyncUserError(userError)
        return
      }
      const requestId = typeof payload?.requestId === 'string' ? payload.requestId : ''
      if (finderSyncRequestSeen(finderSyncRequests, requestId)) return
      const action = finderSyncWireAction(payload?.action)
      if (!action) {
        console.error('Finder Sync handoff refused', 'action')
        dialog.showErrorBox('Install', 'Font Buttler could not read that Finder selection. Use Services (right-click > Services > Install).')
        return
      }
      if (payload?.overflow === 'files') {
        dialog.showErrorBox(finderInstallTitle(action), FINDER_SYNC_TOO_MANY_FILES)
        showMainWindow()
        return
      }
      void enqueueValidatedFinderInstall(action, Array.isArray(payload?.paths) ? payload.paths : []).then((queued) => {
        if (queued) noteFinderSyncRequest(finderSyncRequests, requestId)
      })
    })
    if (registerAgent) applyFinderSyncAgentRegistration(addon, { surface })
    return true
  } catch (error) {
    console.error('Finder Sync receiver is not loaded', error)
    return false
  }
}

function runOsascript(script) {
  return new Promise((resolve) => {
    const child = spawn('osascript', [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.on('error', () => resolve(''))
    child.on('close', () => resolve(stdout.trim()))
    child.stdin.write(script)
    child.stdin.end()
  })
}

async function promptFinderInstallAs(entries) {
  let destinations = []
  try {
    const data = await getApi('/api/destinations')
    destinations = data.destinations ?? []
  } catch {
    destinations = []
  }
  const choices = destinationChoices(destinations)
  let destinationIds = choices[0]?.destinationIds
  if (choices.length > 1) {
    const buttons = [...choices.map((item) => item.label), 'Cancel']
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
    const options = {
      type: 'question',
      title: 'Install as…',
      message: 'Where should Cuttler install the renamed copy?',
      detail: 'Cuttler then asks for a family name. The original file is not changed.',
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
    }
    const choice = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
    if (choice.response === buttons.length - 1) return null
    destinationIds = choices[choice.response]?.destinationIds
  }
  const suggested = suggestedFamilyName(entries)
  const familyName = (await runOsascript(familyNamePromptScript(suggested))).trim()
  if (!familyName) return null
  return { familyName, destinationIds }
}

async function runFinderJob(action, filePaths, job) {
  if (action === FINDER_COMPARE) {
    sendWhenReady('finder-compare', { paths: filePaths })
    showMainWindow()
    return
  }
  if (action === FINDER_LINK_TO) {
    runFinderLinkTo(filePaths)
    return
  }
  if (job?.handles?.length) {
    let verified
    try {
      verified = await readFinderSyncFiles(job.handles)
    } catch (error) {
      console.error('Finder Sync files were not read', error)
      dialog.showErrorBox(finderInstallTitle(action), 'Those files could not be checked.')
      showMainWindow()
      return
    }
    if (!verified?.ok) {
      dialog.showErrorBox(finderInstallTitle(action), verified?.reason || 'The file changed before it could be installed.')
      showMainWindow()
      return
    }
    await runFinderInstallBytes(action, verified.files, verified.skippedWeb)
    return
  }
  await runFinderInstall(action, filePaths)
}

function runFinderLinkTo(filePaths) {
  const collected = collectFinderFontPaths(filePaths, {
    existsSync: fs.existsSync,
    statSync: (filePath) => fs.statSync(filePath),
    includeWeb: true,
    allowDirectories: false,
  })
  if (collected.paths.length === 0) {
    const message = collected.missing.length
      ? 'Those font files could not be found.'
      : 'No font files in that selection.'
    dialog.showErrorBox('Link to …', message)
    showMainWindow()
    return
  }
  sendWhenReady('finder-link-to', { paths: collected.paths })
}

function finderInstallTitle(action) {
  return action === FINDER_INSTALL_AS ? 'Install as…' : 'Install'
}

async function showFinderInstallIssues(action, issues, installed) {
  const message = formatFinderInstallIssues(issues, { installed })
  if (!message) return
  const title = finderInstallTitle(action)
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const options = {
    type: installed > 0 ? 'warning' : 'error',
    title,
    message,
    buttons: ['OK'],
  }
  if (parent) await dialog.showMessageBox(parent, options)
  else await dialog.showMessageBox(options)
}

async function runFinderInstallBytes(action, files, skippedWeb = []) {
  const uploads = (files ?? []).filter((file) => file?.data)
  if (uploads.length === 0) {
    const issues = finderInstallIssues({ skippedWeb })
    dialog.showErrorBox(
      finderInstallTitle(action),
      formatFinderInstallIssues(issues) || 'No installable font files in that selection.',
    )
    showMainWindow()
    return
  }
  notifyOpenFontPending()
  try {
    const imported = await postImportFiles(uploads)
    const entries = imported.entries ?? []
    const issues = finderInstallIssues({
      errors: imported.errors,
      skippedWeb,
      missing: [],
    })
    const eligible = entries.filter((entry) => idsEligibleForFinderInstall([entry]).length > 0)
    if (eligible.length === 0) {
      const already = entries.filter((entry) => entry.status === 'installed')
      if (already.length && !issues.length) {
        showMainWindow()
        return
      }
      throw new Error(formatFinderInstallIssues(issues) || 'Nothing in that selection can be installed.')
    }
    let familyName
    let destinationIds
    if (action === FINDER_INSTALL_AS) {
      const options = await promptFinderInstallAs(eligible)
      if (!options) {
        showMainWindow()
        return
      }
      familyName = options.familyName
      destinationIds = options.destinationIds
    }
    const ids = idsEligibleForFinderInstall(eligible)
    const byFormat = groupIdsByFormat(eligible.filter((entry) => ids.includes(entry.id)))
    for (const group of byFormat) {
      for (const id of group) {
        const entry = eligible.find((item) => item.id === id)
        await postApi('/api/install', {
          ids: [id],
          familyName,
          destinationIds,
          expectedSourceFingerprint: entry?.sourceFingerprint,
        })
      }
    }
    if (issues.length) {
      await showFinderInstallIssues(action, issues, ids.length)
    }
  } catch (error) {
    console.error('Finder install failed', error)
    dialog.showErrorBox(
      finderInstallTitle(action),
      error instanceof Error ? error.message : 'Install failed',
    )
  } finally {
    notifyOpenFontDone()
  }
  showMainWindow()
}

async function runFinderInstall(action, filePaths) {
  const collected = collectFinderFontPaths(filePaths, {
    existsSync: fs.existsSync,
    statSync: (filePath) => fs.statSync(filePath),
  })
  if (collected.paths.length === 0) {
    const issues = finderInstallIssues({
      skippedWeb: collected.skippedWeb,
      missing: collected.missing,
    })
    dialog.showErrorBox(
      finderInstallTitle(action),
      formatFinderInstallIssues(issues) || 'No installable font files in that selection.',
    )
    showMainWindow()
    return
  }
  notifyOpenFontPending()
  try {
    await ensureApiToken()
    const imported = await postApi('/api/import', { paths: collected.paths })
    const entries = imported.entries ?? []
    const issues = finderInstallIssues({
      errors: imported.errors,
      skippedWeb: collected.skippedWeb,
      missing: collected.missing,
    })
    const eligible = entries.filter((entry) => idsEligibleForFinderInstall([entry]).length > 0)
    if (eligible.length === 0) {
      const already = entries.filter((entry) => entry.status === 'installed')
      if (already.length && !issues.length) {
        showMainWindow()
        return
      }
      throw new Error(formatFinderInstallIssues(issues) || 'Nothing in that selection can be installed.')
    }
    let familyName
    let destinationIds
    if (action === FINDER_INSTALL_AS) {
      const options = await promptFinderInstallAs(eligible)
      if (!options) {
        showMainWindow()
        return
      }
      familyName = options.familyName
      destinationIds = options.destinationIds
    }
    const ids = idsEligibleForFinderInstall(eligible)
    const byFormat = groupIdsByFormat(eligible.filter((entry) => ids.includes(entry.id)))
    for (const group of byFormat) {
      await postApi('/api/install', {
        ids: group,
        familyName,
        destinationIds,
      })
    }
    if (issues.length) {
      await showFinderInstallIssues(action, issues, ids.length)
    }
  } catch (error) {
    console.error('Finder install failed', error)
    dialog.showErrorBox(
      finderInstallTitle(action),
      error instanceof Error ? error.message : 'Install failed',
    )
  } finally {
    notifyOpenFontDone()
  }
  showMainWindow()
}

const FONT_CACHE_CLEAR_WARNING = 'Some apps may not see new or updated fonts until you log out.'

async function confirmFontCacheClear() {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const options = {
    type: 'warning',
    title: 'Clear font caches',
    message: 'Clear font caches?',
    detail: `This removes the macOS user font cache. ${FONT_CACHE_CLEAR_WARNING}`,
    buttons: ['Clear font caches', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  }
  const choice = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  return choice.response === 0
}

function logoutDialogHooks(attemptId) {
  return {
    showMainWindow,
    getWindow: () => mainWindow,
    isAppHidden: () => typeof app.isHidden === 'function' && app.isHidden(),
    attemptId,
    log: (message) => logDebug('install', message),
  }
}

function showAppMessageBox(options) {
  return showLogoutMessageBox(dialog, mainWindow, options, logoutDialogHooks())
}

async function offerLogoutAfterFontCacheClear(pathname) {
  const choice = await showAppMessageBox({
    type: 'info',
    title: 'Font caches cleared',
    message: FONT_CACHE_CLEAR_WARNING,
    detail: 'macOS will ask you to confirm.',
    buttons: ['Log out now', 'Later'],
    defaultId: 1,
    cancelId: 1,
  })
  if (choice.response !== 0) return
  const result = await postApi(pathname, {})
  const action = logoutRequestFollowUp(result)
  if (action === 'ignore') return
  if (action === 'probe-allowed') {
    await showAppMessageBox(logoutProbeWouldStartDialogOptions())
    return
  }
  if (action === 'cancelled') {
    await showAppMessageBox({
      type: 'info',
      title: 'Log out',
      message: result.message || LOGOUT_CANCELLED,
      buttons: ['OK'],
      defaultId: 0,
    })
    return
  }
  if (action === 'failed') {
    await presentLogoutFailure({
      message: result && result.message,
      getParent: () => mainWindow,
      showDialog: (parent, options) =>
        showLogoutMessageBox(dialog, parent, options, logoutDialogHooks()),
      notify: () =>
        maybeNotify({
          kind: 'warning',
          source: 'logout',
          message: (result && result.message) || logoutFailedDialogOptions().detail,
        }),
    })
  }
}

async function clearCacheFromMenu(kind) {
  if (kind === 'font') {
    const confirmed = await confirmFontCacheClear()
    if (!confirmed) return
  }
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
      body: JSON.stringify(kind === 'font' ? { confirm: true } : {}),
    })
    const rawBody = await response.text()
    let data
    try {
      data = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      if (response.status === 404) {
        throw new Error(
          'The Cuttler API is out of date. Quit Cuttler completely, then reopen it.',
        )
      }
      throw new Error(
        `Unexpected API response (HTTP ${response.status}): ${rawBody.slice(0, 120)}`,
      )
    }
    if (!response.ok) {
      throw new Error(data.error || 'Could not clear cache')
    }
    const logoutPath = kind === 'font' ? menuLogoutPathAfterCacheClear(data) : null
    if (logoutPath) {
      await offerLogoutAfterFontCacheClear(logoutPath)
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
      : kind === 'clear-all'
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="#000" d="M3.2 3.2h9.6v1.3H3.2zm1.3 2.4h7v7.2c0 .7-.6 1.3-1.3 1.3H5.8c-.7 0-1.3-.6-1.3-1.3zm2.1 1.6v4.2h1.2V7.2zm2.4 0v4.2h1.2V7.2zM6.2 1.8h3.6v1.1H6.2z"/></svg>'
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

async function clearAllActivityFromTray() {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const options = {
    type: 'warning',
    buttons: ['Cancel', 'Clear all'],
    defaultId: 1,
    cancelId: 0,
    message: 'Clear all activity history?',
    detail: 'Undo will no longer be available for these actions.',
  }
  const choice = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  if (choice.response !== 1) {
    return
  }
  try {
    const token = await ensureApiToken()
    const response = await fetch(`${API}/api/activity/clear`, {
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
    console.error('Failed to clear activity', error)
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
  const model = buildTrayMenuModel({ operations: activityOperations, families, appUpdate })
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const items = []
  items.push({
    label: 'Show Cuttler',
    click: () => {
      showMainWindow()
    },
  })
  items.push({ type: 'separator' })
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
    items.push({
      label: 'Clear all',
      icon: menuActionIcon('clear-all'),
      alternate: true,
      click: () => {
        void clearAllActivityFromTray()
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
  if (model.appUpdateRow) {
    items.push({
      label: model.appUpdateRow.label,
      click: () => {
        if (model.appUpdateRow?.htmlUrl) {
          void openExternalUrl(model.appUpdateRow.htmlUrl)
        } else {
          openAppUpdate()
        }
      },
    })
    if (model.appUpdateRow.downloadUrl) {
      items.push({
        label: model.appUpdateRow.downloadLabel || 'Download',
        click: () => {
          void openExternalUrl(model.appUpdateRow.downloadUrl)
        },
      })
    }
  }
  if (families.length === 0) {
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
  if (model.reinstallAll) {
    items.push({
      label: 'Reinstall all fonts',
      click: () => {
        reinstallFromTray(allIds)
      },
    })
  }
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
  items.push({
    label: 'Show logs…',
    click: () => {
      openDebugConsole()
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
  const model = buildTrayMenuModel({ operations: activityOperations, families, appUpdate })
  tray.setToolTip(
    trayTooltip({
      hasUnread: model.hasUnread,
      hasUpdates: model.hasUpdates,
      hasAppUpdate: model.hasAppUpdate,
      fontUpdateCount: families.length,
    }),
  )
  const icon = trayTemplateIcon({
    hasUnread: model.hasUnread,
    hasUpdates: model.hasUpdates,
    hasAppUpdate: model.hasAppUpdate,
  })
  if (icon) {
    tray.setImage(icon)
  }
  tray.setTitle(
    menuBarUpdateBadge({
      hasUnread: model.hasUnread,
      hasUpdates: model.hasUpdates,
      hasAppUpdate: model.hasAppUpdate,
    }),
  )
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
  const iconPath = menuBarTrayIconPath(attention, trayIconPaths())
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
    hasAppUpdate: Boolean(appUpdate?.updateAvailable),
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
  return result.shown === true
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

const applyOpenAtLogin = createLoginItemApplier({
  get: () => app.getLoginItemSettings(),
  set: (settings) => app.setLoginItemSettings(settings),
})

function applyMenuBarSetting(enabled) {
  const next = enabled !== false
  const turningOff = menuBarIconEnabled && !next
  menuBarIconEnabled = next
  if (next) {
    ensureTray()
    return
  }
  destroyTray()
  if (!turningOff) return
  const windowGone =
    !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()
  if (windowGone) showMainWindow()
}

function handleApiEvent(event) {
  if (!event || typeof event !== 'object') {
    return
  }
  if (event.type === 'retail' && event.status && typeof event.status === 'object') {
    retailStatus = event.status
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
    applyAppIconSetting(event.settings.appIcon)
    applyMenuBarSetting(event.settings.menuBarIcon)
    applyOpenAtLogin(event.settings.openAtLogin)
    applyOfficeCacheSetting(event.settings.clearOfficeFontCache)
    applyAdobeCacheSetting(event.settings.clearAdobeFontCache)
    applyNativeNotificationSetting(event.settings.nativeNotifications)
    applyDocumentOpenWatchSetting(event.settings.watchDocumentOpens)
  }
  if (event.type === 'notice' && event.notice) {
    if (
      event.notice.source === 'logout' ||
      event.notice.source === 'logout-waiting' ||
      event.notice.source === 'logout-probe'
    ) {
      presentLogoutNotice({
        notice: event.notice,
        getWindow: () => mainWindow,
        log: (message) => logDebug('install', message),
        showMessageBox: (parent, options, attemptId) =>
          showLogoutMessageBox(dialog, parent, options, logoutDialogHooks(attemptId)),
        showWaitingNotice: (parent, options, attemptId) =>
          showLogoutMessageBox(dialog, parent, options, logoutDialogHooks(attemptId)),
        notify(notice) {
          try {
            return maybeNotify(notice)
          } catch {
            return false
          }
        },
      })
    } else {
      try {
        maybeNotify(event.notice)
      } catch {
        // A missing notification permission must not drop the in-app dialog.
      }
    }
    if (isWatchFailureNotice(event.notice)) {
      deliverWatchNotices(watchNoticeBuffer.push(event.notice))
    }
  }
  if (event.type === 'app-update' && event.update) {
    appUpdate = event.update
    refreshTrayMenu()
    Menu.setApplicationMenu(buildAppMenu())
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

function probeInstallRuntime() {
  const detected = detectAppUpdateRuntime(process.execPath)
  if (!app.isPackaged) return { ...detected, packaged: false }
  return { ...detected, packaged: true }
}

let appUpdateInstall
function appUpdateInstaller() {
  if (!appUpdateInstall) {
    appUpdateInstall = createAppUpdateInstaller({
      env: process.env,
      currentVersion: () => app.getVersion(),
      probeRuntime: () => probeInstallRuntime(),
      openPath: (file) => shell.openPath(file),
      openedDmgRecord: openedUpdateDmgRecordFile(app.getPath('userData')),
      quit: () => {
        isQuitting = true
        app.quit()
      },
      pid: process.pid,
      onProgress: (payload) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('app-update-install', payload)
        }
      },
    })
  }
  return appUpdateInstall
}

async function loadAppUpdate(refresh = false) {
  // Version check only. Downloading waits for a click on the Settings Update badge.
  try {
    await ensureApiToken()
    const url = `${API}/api/app-update${refresh ? '?refresh=1' : ''}`
    const response = await fetch(url, {
      headers: apiHeaders(),
    })
    const data = await response.json()
    if (data && data.update && typeof data.update === 'object') {
      appUpdate = data.update
      refreshTrayMenu()
      Menu.setApplicationMenu(buildAppMenu())
    }
  } catch (error) {
    console.error('Failed to check GitHub Releases', error)
  }
}

/**
 * Background check for the Displaay retail collection.
 *
 * Lives here rather than in the renderer so it keeps running with the window closed, the same reason
 * the app-update poll does. Deliberately sends no `refresh`, so the worker answers from its cached
 * manifest — the regenerate webhook purges that cache, so a new generation still surfaces promptly
 * without every client rebuilding the manifest on its own schedule.
 *
 * The tick only calls `/api/retail/check`. When "Automatically install updates" is on, that check
 * installs updates of families already chosen to sync. It does not download families the user turned off.
 */
async function retailTick() {
  const status = retailStatus
  // No token check: without one of the user's own the server falls back to the built-in trial token.
  if (!status || !status.enabled) return
  const minutes = Number(status.autoCheckMinutes)
  if (!Number.isFinite(minutes) || minutes <= 0) return

  const lastAt = status.checkedAt ? Date.parse(status.checkedAt) : Number.NaN
  const due = !Number.isFinite(lastAt) || Date.now() - lastAt >= minutes * 60 * 1000
  if (!due) return

  try {
    await ensureApiToken()
    // The response also arrives as a `retail` event, which refreshes `retailStatus` and the renderer.
    await fetch(`${API}/api/retail/check`, {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    })
  } catch {
    // Quiet: a background check must never interrupt, and the next tick retries.
  }
}

async function loadRetailStatus() {
  try {
    await ensureApiToken()
    const response = await fetch(`${API}/api/retail/status`, { headers: apiHeaders() })
    const data = await response.json()
    if (data && data.status && typeof data.status === 'object') {
      retailStatus = data.status
    }
  } catch {
    // The next tick picks it up once the server is reachable.
  }
}

async function listenForApiEvents() {
  let delayMs = 2000
  while (!isQuitting) {
    try {
      const token = await ensureApiToken()
      const response = await fetch(`${API}/api/events?client=background`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok || !response.body) {
        throw new Error('events unavailable')
      }
      delayMs = 2000
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
      const wait = delayMs + Math.random() * delayMs * 0.25
      await new Promise((resolve) => setTimeout(resolve, wait))
      delayMs = Math.min(delayMs * 2, 30_000)
    }
  }
}

function buildAppMenu() {
  const settingsItem = {
    label: 'Settings…',
    accelerator: 'CommandOrControl+,',
    click: openSettings,
  }
  const openDocumentItem = {
    label: 'Open Document…',
    accelerator: 'CommandOrControl+O',
    click: () => {
      void openDocumentFromMenu()
    },
  }
  const compareFontsItem = {
    label: 'Compare Fonts…',
    click: () => {
      void pickCompareFonts().then((paths) => {
        if (!paths || paths.length === 0) return
        sendWhenReady('finder-compare', { paths })
      })
    },
  }
  return Menu.buildFromTemplate([
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              {
                label: 'Check for Updates…',
                click: openAppUpdate,
              },
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              {
                label: 'Show logs…',
                accelerator: 'CommandOrControl+Alt+L',
                click: openDebugConsole,
              },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : [
          {
            label: 'File',
            submenu: [
              openDocumentItem,
              compareFontsItem,
              { type: 'separator' },
              {
                label: 'Check for Updates…',
                click: openAppUpdate,
              },
              settingsItem,
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]),
    ...(process.platform === 'darwin'
      ? [
          {
            label: 'File',
            submenu: [openDocumentItem, compareFontsItem, { type: 'separator' }, { role: 'close' }],
          },
        ]
      : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: 'Fonts',
      submenu: [
        {
          label: 'Compare',
          accelerator: 'Alt+CommandOrControl+C',
          click: () => {
            sendWhenReady('open-compare')
            showMainWindow()
          },
        },
      ],
    },
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
    {
      role: 'help',
      submenu: [
        {
          label: 'Show logs…',
          accelerator: 'CommandOrControl+Alt+L',
          click: openDebugConsole,
        },
      ],
    },
  ])
}

if (process.argv.includes('--finder-sync-agent-status')) {
  app.whenReady().then(() => {
    reportFinderSyncAgentStatus()
  })
} else {
// Electron's lock follows userData, which Cuttler and the installed Font
// Buttler.app share. A second copy of this exact binary quits. A newer binary
// at this path still listens: the helper in this bundle has to reach it, and
// the handoff is performed rather than acknowledged and dropped. The shared
// catalog stays with the process that already owns it.
const instanceLockPath = sameExecutableLockPath(process.execPath, path.join(app.getPath('temp'), 'font-butler-instance'))
let executableInode = 0
try {
  const ino = fs.statSync(process.execPath).ino
  const value = typeof ino === 'bigint' ? Number(ino) : Number(ino)
  if (Number.isSafeInteger(value) && value > 0) executableInode = value
} catch {
  executableInode = 0
}
const instance = claimSameExecutableInstance({
  lockPath: instanceLockPath,
  pid: process.pid,
  inode: executableInode,
  legacyLiveIsCurrent: false,
  isAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return error?.code === 'EPERM'
    }
  },
  io: fs,
})
if (instance.held) {
  const releaseInstance = () => {
    releaseSameExecutableInstance({ lockPath: instanceLockPath, pid: process.pid, io: fs })
  }
  process.on('exit', releaseInstance)
}
const gotLock = app.requestSingleInstanceLock()
const launchMode = sharedLibraryLaunchMode({
  sameExecutableHeld: instance.held,
  sharedLockHeld: !gotLock,
})
const receiverOnly = launchMode === 'receiver'
if (launchMode === 'quit') {
  app.quit()
} else {
  const finderSyncRegisterOptions = { surface: !receiverOnly, registerAgent: !receiverOnly }
  // Register once early for handoffs; Register() in the native addon is
  // idempotent, so whenReady may call it again safely as a fallback.
  app.on('will-finish-launching', () => {
    if (!receiverOnly) registerNativeFinderServices()
    registerFinderSyncReceiver(finderSyncRegisterOptions)
  })
  if (!receiverOnly) registerNativeFinderServices()

  app.on('second-instance', (_event, argv) => {
    if (app.isPackaged && !apiBootstrapReady && lastBootstrapError) {
      void retryPackagedBootstrap()
      return
    }
    const comparePaths = finderCompareArgv(argv)
    if (comparePaths) {
      enqueueFinderJob(FINDER_COMPARE, comparePaths)
      showMainWindow()
      return
    }
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
      return
    }
    queuedFiles.push(filePath)
  })

  // A font-butler URL is not an install. Any page could open one.
  // Compare is the only URL this process accepts. It waits on the Finder
  // job queue so a URL that arrives before bootstrap is not dropped.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const comparePaths = typeof url === 'string' ? finderCompareArgv([url]) : null
    if (!comparePaths) return
    enqueueFinderJob(FINDER_COMPARE, comparePaths)
    showMainWindow()
  })

  app.on('before-quit', (event) => {
    isQuitting = true
    if (receiverOwnerWatchTimer) {
      clearInterval(receiverOwnerWatchTimer)
      receiverOwnerWatchTimer = null
    }
    if (documentAppObserver) documentAppObserver.stop()
    if (receiverOnly) return
    if (!sessionReleaseOnQuitStarted) {
      sessionReleaseOnQuitStarted = true
      event.preventDefault()
      void (async () => {
        try {
          if (!apiToken) apiToken = readApiTokenFile()
          await fetch(`${API}/api/session/release`, {
            method: 'POST',
            headers: apiHeaders(),
            signal: AbortSignal.timeout(8_000),
          })
        } catch {
          // SIGTERM still asks the API worker to release faces left on for this session.
        }
        app.quit()
      })()
      return
    }
    if (apiChild) {
      const child = apiChild
      apiChild = null
      child.kill()
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Already exited.
        }
      }, 8_000).unref?.()
    }
  })

  /**
   * Run the Hono API in a child process, not in this UI process.
   *
   * Dev (`npm run electron`) already starts `npm run server` separately. The packaged app used to
   * import the bundle into Electron main, so an initial Displaay retail sync froze the window.
   */
  function spawnApiWorker({ serverPath, staticDir, port }) {
    return new Promise((resolve, reject) => {
      const child = utilityProcess.fork(serverPath, [], {
        stdio: 'pipe',
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) =>
                key !== 'FONT_BUTLER_TEST' &&
                key !== 'FONT_BUTLER_DEV_BOOTSTRAP' &&
                key !== 'FONT_BUTLER_SHELL',
            ),
          ),
          FONT_BUTLER_SERVE: '1',
          FONT_BUTLER_API_PORT: String(port),
          FONT_BUTLER_STATIC_DIR: staticDir,
          // Set above from the test-feed marker when the parent env did not
          // already have it. The spread would drop it if this key were omitted
          // after a future filter, and the worker would then use the real library.
          ...(process.env.FONT_BUTLER_DATA
            ? { FONT_BUTLER_DATA: process.env.FONT_BUTLER_DATA }
            : {}),
          // Main already ran migration. A second pass can move fonts main
          // stalled, or throw again on a path rewrite main already attempted.
          ...(process.env[MIGRATION_HANDLED_ENV] === '1'
            ? { [MIGRATION_HANDLED_ENV]: process.env[MIGRATION_HANDLED_ENV] }
            : {}),
          ...(process.env[MIGRATION_STALL_ENV] === '1'
            ? {
                [MIGRATION_STALL_ENV]: process.env[MIGRATION_STALL_ENV],
                [MIGRATION_DATA_ROOT_ENV]: process.env[MIGRATION_DATA_ROOT_ENV],
              }
            : {}),
          // Same reason as FONT_BUTLER_DATA: the worker must not write the
          // real app's main.log when this process is Font Buttler Test.
          ...(process.env.FONT_BUTLER_LOG_NAME
            ? { FONT_BUTLER_LOG_NAME: process.env.FONT_BUTLER_LOG_NAME }
            : {}),
        },
      })
      apiChild = child
      let settled = false
      let buffer = ''

      function finish(error, info) {
        if (settled) return
        settled = true
        if (error) {
          error.tail = buffer.slice(-4000)
          child.kill()
          apiChild = null
          reject(error)
          return
        }
        resolve(info)
      }

      child.on('exit', (code) => {
        if (!settled) {
          const error = new Error(`Cuttler API worker exited (${code ?? 'unknown'})`)
          if (code === 1 && /EADDRINUSE|address already in use/i.test(buffer)) {
            error.code = 'EADDRINUSE'
          } else if (code) {
            error.code = code
          }
          error.tail = buffer.slice(-4000)
          finish(error)
          return
        }
        apiChild = null
        if (isQuitting || workerInitFailed) {
          return
        }
        if (!apiBootstrapReady) {
          return
        }
        console.error('Cuttler API worker exited unexpectedly')
        void restartPackagedBackend()
      })

      child.stdout?.on('data', (chunk) => {
        const text = String(chunk)
        buffer += text
        logDebugMultiline('api-worker', text)
        if (buffer.length > 64_000) buffer = buffer.slice(-32_000)
        const match = buffer.match(/Cuttler API on http:\/\/127\.0\.0\.1:(\d+)/)
        if (!match) return
        finish(null, { port: Number(match[1]), token: readApiTokenFile() })
      })
      child.stderr?.on('data', (chunk) => {
        const text = String(chunk)
        buffer += text
        apiWorkerLogTail = buffer.slice(-8000)
        logDebugMultiline('api-stderr', text)
        if (buffer.length > 64_000) buffer = buffer.slice(-32_000)
        console.error(text.trimEnd())
      })
    })
  }

  async function startPackagedBackend() {
    if (migrationFailure?.blockWorker) {
      const where = migrationFailure.stalledDataDir
        ? `Your library is still in ${migrationFailure.stalledDataDir}.`
        : 'Library paths could not be updated.'
      throw new Error(
        `Cuttler could not finish opening your library. ${where} Quit and open Cuttler again. Nothing was recovered or deleted.`,
      )
    }
    if (!app.isPackaged) {
      return
    }
    const staticDir = path.join(__dirname, '../dist')
    const serverPath = path.join(__dirname, 'server.bundle.mjs')
    if (!fs.existsSync(serverPath)) {
      throw new Error('Packaged API worker is missing (electron/server.bundle.mjs).')
    }
    const preferred = Number(new URL(API).port || DEFAULT_API_PORT)
    let lastError
    for (let port = preferred; port < preferred + 20; port += 1) {
      try {
        const info = await spawnApiWorker({ serverPath, staticDir, port })
        API = `http://127.0.0.1:${info.port}`
        publishApiEndpoint(API)
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

  async function bootstrapApi(options = {}) {
    if (!app.isPackaged) {
      try {
        await ensureApiToken()
      } catch (error) {
        console.error('Could not connect to Cuttler API (dev)', error)
      }
      publishApiEndpoint(API)
      apiBootstrapReady = true
      return true
    }
    bootstrapping = true
    workerInitFailed = false
    try {
      await stopPackagedApiWorker()
      await startPackagedBackend()
      await waitForWorkerCatalogOrFailure()
      apiBootstrapReady = true
      lastBootstrapError = null
      publishApiEndpoint(API)
      if (mainWindow && !mainWindow.isDestroyed() && mainWindowKind !== 'main') {
        createWindow()
      }
      try {
        await ensureApiToken()
      } catch (tokenError) {
        console.error('Could not read bootstrap settings', tokenError)
      }
      return true
    } catch (error) {
      if (error && typeof error === 'object' && 'tail' in error && typeof error.tail === 'string') {
        apiWorkerLogTail = error.tail
      }
      console.error('Could not bootstrap Cuttler API', error)
      logDebug(
        'bootstrap',
        error instanceof Error ? error.stack ?? error.message : String(error),
      )
      apiBootstrapReady = false
      if (!options.suppressFailureUi) {
        await showBootstrapFailure(error)
      }
      return false
    } finally {
      bootstrapping = false
    }
  }

  runPackagedBootstrap = bootstrapApi

  let restartingBackend = false
  async function restartPackagedBackend() {
    if (isQuitting || restartingBackend || !app.isPackaged) return
    restartingBackend = true
    try {
      await startPackagedBackend()
      await ensureApiToken()
      apiBootstrapReady = true
      lastBootstrapError = null
      for (const win of BrowserWindow.getAllWindows()) {
        void win.loadURL(UI)
      }
      dialog.showErrorBox(
        'Cuttler restarted the local service',
        'The font service stopped unexpectedly and was started again. Your library was reloaded.',
      )
    } catch (error) {
      console.error('Could not restart Cuttler API', error)
      apiBootstrapReady = false
      lastBootstrapError = error instanceof Error ? error : new Error(String(error))
      await showBootstrapFailure(lastBootstrapError)
    } finally {
      restartingBackend = false
    }
  }

  app.whenReady().then(async () => {
    stageLaunchAnnouncement()
    debugLogFilePath = defaultLogFilePath(app.getPath('home'))
    const fileWriter = createDebugLogFileWriter(debugLogFilePath)
    attachDebugLogPersistence(debugLog, fileWriter)
    logDebug('main', `Cuttler ${app.getVersion()} starting`)
    try {
      cleanupOpenedUpdateDmgs({
        recordFile: openedUpdateDmgRecordFile(app.getPath('userData')),
      })
    } catch (error) {
      console.error('Could not clean up opened update disk images', error)
    }
    if (process.platform === 'darwin' && app.dock) {
      if (receiverOnly) app.dock.hide()
      else applyDockIcon()
    }
    Menu.setApplicationMenu(buildAppMenu())
    nativeTheme.on('updated', () => {
      mainWindow?.setBackgroundColor(windowBackgroundColor())
    })
    if (!receiverOnly) registerNativeFinderServices()
    registerFinderSyncReceiver(finderSyncRegisterOptions)
    if (receiverOnly) {
      adoptPublishedApiEndpoint()
      await finderJobs.start()
      // Owner may be on a non-default port; keep rediscovering, and exit when
      // the library owner is gone so a relaunch can take ownership.
      receiverOwnerWatchTimer = setInterval(() => {
        if (isQuitting) return
        adoptPublishedApiEndpoint()
        void fetch(`${API}/api/health`, { signal: AbortSignal.timeout(2_000) })
          .then((response) => {
            if (response.ok) return
            throw new Error(`owner health ${response.status}`)
          })
          .catch(() => {
            if (isQuitting) return
            console.error('Finder Sync receiver: library owner is gone; exiting so a relaunch can own the library.')
            app.quit()
          })
      }, 5_000)
      if (typeof receiverOwnerWatchTimer.unref === 'function') receiverOwnerWatchTimer.unref()
      return
    }
    const bootstrapOk = await bootstrapApi()
    consumeFinderSyncPendingErrors()
    ensureTray()
    if (bootstrapOk) {
      startMainUiAfterBootstrap()
      setInterval(() => {
        if (!isQuitting) void loadAppUpdate()
      }, APP_UPDATE_POLL_MS)
      setInterval(() => {
        if (!isQuitting) void retailTick()
      }, RETAIL_TICK_MS)
    }
    try {
      refreshFinderSyncRegistration({
        platform: process.platform,
        packaged: app.isPackaged,
        appPath: outermostAppBundle(process.execPath),
        testFeed: runningTestFeed(),
        spawnSync,
      })
    } catch (error) {
      console.error('Finder Sync registration was not refreshed', error)
    }
    const compareLaunch = compareLaunchArgv(process.argv)
    if (compareLaunch) {
      enqueueFinderJob(FINDER_COMPARE, compareLaunch.paths)
      showMainWindow()
    }
    const claimedByCompare = compareLaunch?.claimed ?? new Set()
    const fromArgv = process.argv.filter(
      (arg) => /\.(ttf|otf|ttc|otc|woff2?)$/i.test(arg) && !claimedByCompare.has(arg),
    )
    for (const filePath of [...queuedFiles, ...fromArgv]) {
      if (claimedByCompare.has(filePath)) continue
      await openFont(filePath)
    }
    queuedFiles.length = 0
    await finderJobs.start()
  })

  app.on('window-all-closed', () => {
    if (
      !shouldQuitOnWindowAllClosed({
        platform: process.platform,
        menuBarIconEnabled,
      })
    ) {
      return
    }
    app.quit()
  })

  app.on('activate', () => {
    showMainWindow()
  })
}
}

ipcMain.on('renderer-app-mounted', () => {
  announcementSlot.markMounted()
  flushWatchNotices()
})

ipcMain.handle('announcement:pending', () => announcementSlot.pull())

ipcMain.on('announcement:dismiss', (_event, id) => {
  try {
    if (typeof id === 'string' && id.trim()) {
      announcementSlot.acknowledge(id.trim())
      dismissAnnouncement({ userDataDir: app.getPath('userData'), id: id.trim() })
    }
  } catch (error) {
    console.error('Could not dismiss announcement', error)
  }
})

ipcMain.handle('quit-app', () => {
  isQuitting = true
  app.quit()
})

ipcMain.handle('debug-console:show', () => {
  openDebugConsole()
  return true
})

ipcMain.handle('debug-log:get-snapshot', () => debugLog.getSnapshot())

ipcMain.handle('debug-log:copy-all', () => {
  const text = debugLog.getText()
  if (text) clipboard.writeText(text)
  return text
})

ipcMain.handle('debug-log:clear', () => {
  debugLog.clear()
  return true
})

ipcMain.handle('debug-log:reveal-file', () => {
  const dir = path.dirname(debugLogFilePath)
  if (fs.existsSync(debugLogFilePath)) {
    shell.showItemInFolder(debugLogFilePath)
    return debugLogFilePath
  }
  shell.openPath(dir)
  return dir
})

ipcMain.handle('get-api-token', async () => {
  try {
    return await ensureApiToken()
  } catch {
    return null
  }
})

ipcMain.handle('open-external', async (_event, url) => {
  if (typeof url !== 'string') return false
  return openExternalUrl(url)
})

ipcMain.handle('open-finder-extensions', async () => {
  if (process.platform !== 'darwin') return false
  await shell.openExternal(FINDER_SYNC_SETTINGS_URL)
  return true
})

ipcMain.handle('get-finder-sync-agent-status', () => {
  if (process.platform !== 'darwin') return { status: 'unsupported', error: '', enabled: false }
  const record = loadFinderSyncAgentRecord()
  const addon = loadFinderSyncReceiver()
  if (!addon) {
    return { status: 'unavailable', error: 'Finder Sync receiver is not loaded.', enabled: record.enabled !== false }
  }
  const status = parseAgentJson(addon.agentStatus())
  return { ...status, enabled: record.enabled !== false }
})

ipcMain.handle('set-finder-sync-agent-enabled', (_event, enabled) => {
  if (process.platform !== 'darwin') return false
  const addon = loadFinderSyncReceiver()
  if (!addon) return false
  const next = enabled === true
  const record = loadFinderSyncAgentRecord()
  if (!next) {
    saveFinderSyncAgentRecord({ enabled: false, appBundlePath: '', helperPath: '', version: '' })
    const removed = parseAgentJson(addon.unregisterAgent())
    if (removed?.error) console.error('Finder Sync agent unregister failed', removed.error)
    return true
  }
  saveFinderSyncAgentRecord({
    enabled: true,
    appBundlePath: record.appBundlePath,
    helperPath: record.helperPath,
    version: record.version,
  })
  applyFinderSyncAgentRegistration(addon, { surface: true })
  return true
})

ipcMain.handle('open-finder-sync-login-items', () => {
  if (process.platform !== 'darwin') return false
  const addon = loadFinderSyncReceiver()
  if (!addon?.openLoginItems) {
    dialog.showErrorBox('Finder menu', FINDER_SYNC_AGENT_DISABLED)
    return false
  }
  const opened = parseAgentJson(addon.openLoginItems())
  if (opened.ok !== true) {
    dialog.showErrorBox('Finder menu', opened.error || FINDER_SYNC_AGENT_DISABLED)
    return false
  }
  return true
})

ipcMain.handle('install-app-update', () => appUpdateInstaller().start())

ipcMain.handle('app-update-install-state', () => appUpdateInstaller().status())

ipcMain.handle('request-notifications', () => electronNotificationPermission(Notification))

ipcMain.handle('pick-document', () => pickDocumentPath())

async function pickCompareFonts() {
  const options = {
    title: 'Compare Fonts',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2'] }],
  }
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
  if (result.canceled) return null
  return result.filePaths
}

ipcMain.handle('pick-compare-fonts', () => pickCompareFonts())

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
