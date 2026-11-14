const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlay', {
  onState: cb => ipcRenderer.on('overlay:state', (_e, s) => cb(s)),
  action: a => ipcRenderer.send('overlay:action', a),
  setIgnore: v => ipcRenderer.send('overlay:ignore', Boolean(v)),
  hide: () => ipcRenderer.send('overlay:hide')
})
