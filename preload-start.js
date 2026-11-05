// Only the local start page (file://) gets this API; websites never do.
const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('nano', {
    getEngine: () => ipcRenderer.invoke('engine:get'),
    setEngine: id => ipcRenderer.send('engine:set', id),
    web: q => ipcRenderer.invoke('nano:search', q),
    ai: o => ipcRenderer.invoke('nano:ai', o),
    search: q => ipcRenderer.send('start:search', q),
    chat: o => ipcRenderer.invoke('nano:chat', o),
    aiInfo: () => ipcRenderer.invoke('ai:info'), aiModel: id => ipcRenderer.invoke('ai:model', id), aiDownload: id => ipcRenderer.invoke('ai:download', id),
    onProgress: cb => ipcRenderer.on('ai:progress', (_e, d) => cb(d)), memAdd: t => ipcRenderer.invoke('ai:mem:add', t), memDel: id => ipcRenderer.invoke('ai:mem:del', id),
    onToken: cb => ipcRenderer.on('ai:token', (_e, c) => cb(c)), stop: () => ipcRenderer.send('ai:stop'),
    open: (page, q) => ipcRenderer.send('start:open', page, q)
  });
}
