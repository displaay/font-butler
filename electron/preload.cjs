const { contextBridge, ipcRenderer, webUtils } = require('electron')

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
  requestNotifications: () => ipcRenderer.invoke('request-notifications'),
  onOpenSettings: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('open-settings', listener)
    return () => ipcRenderer.removeListener('open-settings', listener)
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
})
