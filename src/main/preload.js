// @ts-check
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flowAPI', {
  // Dictation State & Control
  getState: () => ipcRenderer.invoke('flow:get-state'),
  startDictation: () => ipcRenderer.invoke('flow:start-dictation'),
  stopDictation: (simulatedText) => ipcRenderer.invoke('flow:stop-dictation', simulatedText),
  cancelDictation: () => ipcRenderer.invoke('flow:cancel-dictation'),

  // Event Listeners
  onStateChange: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('flow:state-changed', handler);
    return () => ipcRenderer.removeListener('flow:state-changed', handler);
  },
  onAudioLevels: (callback) => {
    const handler = (_event, levels) => callback(levels);
    ipcRenderer.on('flow:audio-levels', handler);
    return () => ipcRenderer.removeListener('flow:audio-levels', handler);
  },
  onHistoryUpdated: (callback) => {
    const handler = (_event, item) => callback(item);
    ipcRenderer.on('flow:history-updated', handler);
    return () => ipcRenderer.removeListener('flow:history-updated', handler);
  },
  onHelperStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('flow:helper-status', handler);
    return () => ipcRenderer.removeListener('flow:helper-status', handler);
  },
  onRequestAudioStop: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('flow:request-audio-stop', handler);
    return () => ipcRenderer.removeListener('flow:request-audio-stop', handler);
  },

  // Audio Streaming / Metering
  sendAudioLevels: (levels) => ipcRenderer.send('flow:client-audio-levels', levels),

  // History Operations
  getHistory: (limit, offset, query) => ipcRenderer.invoke('flow:get-history', limit, offset, query),
  deleteHistory: (id) => ipcRenderer.invoke('flow:delete-history', id),
  clearHistory: () => ipcRenderer.invoke('flow:clear-history'),

  // Dictionary Operations
  getDictionary: () => ipcRenderer.invoke('flow:get-dictionary'),
  addDictionaryWord: (phrase, replacement) => ipcRenderer.invoke('flow:add-dictionary', phrase, replacement),
  deleteDictionaryWord: (id) => ipcRenderer.invoke('flow:delete-dictionary', id),

  // Settings Operations
  getSettings: () => ipcRenderer.invoke('flow:get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('flow:set-setting', key, value),

  // Notes Operations
  getNotes: () => ipcRenderer.invoke('flow:get-notes'),
  saveNote: (title, content, id) => ipcRenderer.invoke('flow:save-note', title, content, id),
  deleteNote: (id) => ipcRenderer.invoke('flow:delete-note', id),

  // Window Controls & UI
  openHub: (tab) => ipcRenderer.invoke('flow:open-hub', tab),
  minimizeHub: () => ipcRenderer.invoke('flow:window-minimize'),
  maximizeHub: () => ipcRenderer.invoke('flow:window-maximize'),
  closeHub: () => ipcRenderer.invoke('flow:window-close'),
  getHelperStatus: () => ipcRenderer.invoke('flow:get-helper-status'),
  getLocalEngineStatus: () => ipcRenderer.invoke('flow:get-local-engine-status'),
  getLocalWhisperStatus: () => ipcRenderer.invoke('flow:get-local-engine-status')
});
