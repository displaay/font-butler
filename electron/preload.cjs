const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fontcaseDesktop', {
  reveal: (filePath) => ipcRenderer.invoke('reveal', filePath),
})
