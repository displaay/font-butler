const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fontButlerDesktop', {
  reveal: (filePath) => ipcRenderer.invoke('reveal', filePath),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  onOpenSettings: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('open-settings', listener)
    return () => ipcRenderer.removeListener('open-settings', listener)
  },
})
