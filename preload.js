const { contextBridge, ipcRenderer } = require('electron');
const send = ch => (...a) => ipcRenderer.send(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  ready: send('ui-ready'), newTab: send('tab:new'), selectTab: send('tab:select'), closeTab: send('tab:close'),
  navigate: send('navigate'), setEngine: send('engine:set'), back: send('back'), forward: send('forward'), reload: send('reload'),
  sidebarWidth: send('sidebar:width'),
  signup: (u, p) => ipcRenderer.invoke('auth:signup', { u, p }), login: (u, p) => ipcRenderer.invoke('auth:login', { u, p }), logout: () => ipcRenderer.invoke('auth:logout'),
  getHistory: () => ipcRenderer.invoke('hist:get'), delHistory: id => ipcRenderer.invoke('hist:del', id), clearHistory: () => ipcRenderer.invoke('hist:clear'),
  getBookmarks: () => ipcRenderer.invoke('bm:get'), addBookmark: () => ipcRenderer.invoke('bm:add'), delBookmark: id => ipcRenderer.invoke('bm:del', id),
  onState: cb => ipcRenderer.on('state', (_e, s) => cb(s)),
  onFocusUrl: cb => ipcRenderer.on('focus-url', () => cb())
});
