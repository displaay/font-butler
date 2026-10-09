const { contextBridge, ipcRenderer, webUtils } = require('electron')

const queuedWatchNotices = []
const watchNoticeListeners = new Set()
ipcRenderer.on('watch-notices', (_event, notices) => {
  const list = Array.isArray(notices) ? notices : []
  if (list.length === 0) return
  if (watchNoticeListeners.size === 0) {
    queuedWatchNotices.push(...list)
    return
  }
  for (const listener of watchNoticeListeners) listener(list)
})

contextBridge.exposeInMainWorld('fontButlerDesktop', {
  platform: process.platform,
  getPathForFile: (file) => {
    try {
      const value = webUtils.getPathForFile(file)
      return value && String(value).trim() ? String(value) : undefined
    } catch {
      return undefined
    }
  },
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  getApiToken: () => ipcRenderer.invoke('get-api-token'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  showDebugLogs: () => ipcRenderer.invoke('debug-console:show'),
  signalAppMounted: () => ipcRenderer.send('renderer-app-mounted'),
  onWatchNotices: (callback) => {
    const listener = (notices) => callback(notices)
    watchNoticeListeners.add(listener)
    if (queuedWatchNotices.length > 0) {
      const pending = queuedWatchNotices.splice(0, queuedWatchNotices.length)
      callback(pending)
    }
    return () => watchNoticeListeners.delete(listener)
  },
  requestNotifications: () => ipcRenderer.invoke('request-notifications'),
  onOpenSettings: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('open-settings', listener)
    return () => ipcRenderer.removeListener('open-settings', listener)
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  installAppUpdate: () => ipcRenderer.invoke('install-app-update'),
  getAppUpdateInstallState: () => ipcRenderer.invoke('app-update-install-state'),
  onAppUpdateInstall: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('app-update-install', listener)
    return () => ipcRenderer.removeListener('app-update-install', listener)
  },
  onReinstallFonts: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('reinstall-fonts', listener)
    return () => ipcRenderer.removeListener('reinstall-fonts', listener)
  },
  onOpenTab: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('open-tab', listener)
    return () => ipcRenderer.removeListener('open-tab', listener)
  },
  onFinderLinkTo: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('finder-link-to', listener)
    return () => ipcRenderer.removeListener('finder-link-to', listener)
  },
})
