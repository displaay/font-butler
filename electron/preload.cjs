const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fontButlerDesktop', {
  reveal: (filePath) => ipcRenderer.invoke('reveal', filePath),
})
