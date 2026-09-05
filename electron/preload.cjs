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
  reveal: (filePath) => ipcRenderer.invoke('reveal', filePath),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  getApiToken: () => ipcRenderer.invoke('get-api-token'),
  requestNotifications: () => {
    try {
      if (typeof Notification === 'undefined') {
        return Promise.resolve('denied')
      }
      return Notification.requestPermission()
    } catch {
      return Promise.resolve('denied')
    }
  },
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
})
