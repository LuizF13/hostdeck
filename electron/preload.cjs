const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hostDeckDesktop", {
  getUpdateStatus: () => ipcRenderer.invoke("updates:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdateStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("updates:status", listener);
    return () => ipcRenderer.removeListener("updates:status", listener);
  },

  getConfigStatus: () => ipcRenderer.invoke("config:get-status"),
  saveConfig: (input) => ipcRenderer.invoke("config:save", input),
  getPluginStatus: () => ipcRenderer.invoke("plugins:get-status"),
  savePlugin: (input) => ipcRenderer.invoke("plugins:save", input),
  testDiscord: () => ipcRenderer.invoke("discord:test"),

  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  repairWindowsShortcuts: () => ipcRenderer.invoke("windows:repair-shortcuts"),
  onWindowMaximized: (callback) => {
    const listener = (_event, value) => callback(Boolean(value));
    ipcRenderer.on("window:maximized", listener);
    return () => ipcRenderer.removeListener("window:maximized", listener);
  },

  getMonitorState: () => ipcRenderer.invoke("monitor:get-state"),
  scanNow: () => ipcRenderer.invoke("monitor:scan-now"),
  recordManualAction: (input) => ipcRenderer.invoke("monitor:manual-action", input),
  onMonitorStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("monitor:status", listener);
    return () => ipcRenderer.removeListener("monitor:status", listener);
  },
  onMonitorAlert: (callback) => {
    const listener = (_event, insight) => callback(insight);
    ipcRenderer.on("monitor:alert", listener);
    return () => ipcRenderer.removeListener("monitor:alert", listener);
  },
  onOpenAiInbox: (callback) => {
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("navigation:ai-inbox", listener);
    return () => ipcRenderer.removeListener("navigation:ai-inbox", listener);
  },
  getSystemTheme: () => ipcRenderer.invoke("theme:get-system"),
});
