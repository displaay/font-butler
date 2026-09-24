const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fontButlerDebugConsole', {
  getSnapshot: () => ipcRenderer.invoke('debug-log:get-snapshot'),
  subscribe: (callback) => {
    const onLine = (_event, line) => callback(line)
    const onClear = (_event) => callback(null)
    ipcRenderer.on('debug-log:line', onLine)
    ipcRenderer.on('debug-log:cleared', onClear)
    return () => {
      ipcRenderer.removeListener('debug-log:line', onLine)
      ipcRenderer.removeListener('debug-log:cleared', onClear)
    }
  },
  copyAll: () => ipcRenderer.invoke('debug-log:copy-all'),
  revealLogFile: () => ipcRenderer.invoke('debug-log:reveal-file'),
  clear: () => ipcRenderer.invoke('debug-log:clear'),
})
