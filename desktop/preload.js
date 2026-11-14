const { contextBridge, ipcRenderer } = require('electron')

// What the web app sees as window.desktop. Nothing else from Node or Electron is exposed.
contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  sendOverlayState: state => ipcRenderer.send('app:overlay-state', state),
  onAction: cb => {
    const handler = (_e, action) => cb(action)
    ipcRenderer.on('desktop:action', handler)
    return () => ipcRenderer.removeListener('desktop:action', handler)
  }
})
