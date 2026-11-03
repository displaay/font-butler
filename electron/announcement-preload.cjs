const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fontButlerAnnouncement', {
  dismiss: () => ipcRenderer.send('announcement:dismiss'),
})
