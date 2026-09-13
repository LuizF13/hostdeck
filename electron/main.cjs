const { app, BrowserWindow, ipcMain, shell, Notification, nativeTheme, dialog, Tray, Menu } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const PROD_APP_ID = "com.hostdeck.desktop";
const DEV_APP_ID = "com.hostdeck.desktop.dev";
const APP_NAME = "HostDeck";
const APP_ID = app.isPackaged ? PROD_APP_ID : DEV_APP_ID;
const HOSTDECK_RELEASE_REPOSITORY = String(process.env.HOSTDECK_GITHUB_REPOSITORY || "LuizF13/hostdeck").trim();

try { app.setName(APP_NAME); } catch {}
try { process.title = APP_NAME; } catch {}
if (process.platform === "win32") {
  try { app.setAppUserModelId(APP_ID); } catch {}
}

const DEV_URL = process.env.HOSTDECK_DEV_SERVER_URL;
const FORCE_DEV_SERVER = process.env.HOSTDECK_DEV === "1";
const PREFERRED_PORT = Number(process.env.HOSTDECK_PORT || 3210);
const START_HIDDEN = process.argv.includes("--background");
let runtimePort = PREFERRED_PORT;
let logStream = null;
const DEFAULT_MONITOR_SECONDS = 120;
const DEFAULT_NOTIFICATION_COOLDOWN_MINUTES = 15;
const DEFAULT_GEMINI_COOLDOWN_MINUTES = 10;
const DEFAULT_RECOVERY_COOLDOWN_MINUTES = 15;
const DEFAULT_MAX_RECOVERY_ATTEMPTS_PER_HOUR = 2;
const DEFAULT_UPDATE_CHECK_MINUTES = 30;
const PLUGIN_ENV_FIELDS = {
  square: { apiKey: "SQUARECLOUD_API_KEY" },
  vercel: { token: "VERCEL_TOKEN", teamId: "VERCEL_TEAM_ID" },
  render: { apiKey: "RENDER_API_KEY" },
  netlify: { token: "NETLIFY_TOKEN" },
  cloudflare: { token: "CLOUDFLARE_API_TOKEN", accountId: "CLOUDFLARE_ACCOUNT_ID" },
  digitalocean: { token: "DIGITALOCEAN_TOKEN" },
  heroku: { token: "HEROKU_API_KEY" },
  discloud: { token: "DISCLOUD_API_TOKEN" },
  nextcloud: { serverUrl: "NEXTCLOUD_URL", username: "NEXTCLOUD_USERNAME", appPassword: "NEXTCLOUD_APP_PASSWORD", rootPath: "NEXTCLOUD_ROOT_PATH" },
};
const REQUIRED_PLUGIN_FIELDS = {
  square: ["SQUARECLOUD_API_KEY"],
  vercel: ["VERCEL_TOKEN"],
  render: ["RENDER_API_KEY"],
  netlify: ["NETLIFY_TOKEN"],
  cloudflare: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  digitalocean: ["DIGITALOCEAN_TOKEN"],
  heroku: ["HEROKU_API_KEY"],
  discloud: ["DISCLOUD_API_TOKEN"],
  nextcloud: ["NEXTCLOUD_URL", "NEXTCLOUD_USERNAME", "NEXTCLOUD_APP_PASSWORD"],
};
let nextProcess = null;
let mainWindow = null;
let splashWindow = null;
let serverUrl = DEV_URL || null;
let monitorTimer = null;
let monitorBusy = false;
let previousSnapshot = null;
let lastMonitorCheckedAt = null;
let lastGeminiAnalyzeAt = 0;
let updateCheckTimer = null;
let tray = null;
let isQuitting = false;
let discordRpcSocket = null;
let discordRpcReady = false;
let discordRpcBuffer = Buffer.alloc(0);
let discordRpcActivity = { startedAt: Date.now() };
let discordRpcReconnectTimer = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function logFilePath() {
  return path.join(app.getPath("userData"), "logs", "main.log");
}

function ensureLogStream() {
  if (logStream && !logStream.destroyed) return logStream;
  const file = logFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  logStream = fs.createWriteStream(file, { flags: "a" });
  return logStream;
}

function logMessage(level, ...parts) {
  const line = `[${new Date().toISOString()}] [${level}] ${parts.map((part) => {
    if (part instanceof Error) return part.stack || part.message;
    if (typeof part === "string") return part;
    try { return JSON.stringify(part); } catch { return String(part); }
  }).join(" ")}\n`;
  try { ensureLogStream().write(line); } catch {}
  if (!app.isPackaged || process.env.HOSTDECK_DEBUG === "1") {
    const fn = level === "ERROR" ? console.error : console.log;
    fn(line.trimEnd());
  }
}

function playAttentionSound(times = 1, gap = 160) {
  const total = Math.max(1, Number(times) || 1);
  for (let i = 0; i < total; i += 1) {
    setTimeout(() => {
      try { shell.beep(); } catch {}
    }, i * gap);
  }
}

function getFreePort(preferred = PREFERRED_PORT) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const probe = net.createServer();
      probe.unref();
      probe.once("error", () => {
        if (port !== 0) return tryPort(0);
        resolve(preferred);
      });
      probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
        const address = probe.address();
        const selected = typeof address === "object" && address ? address.port : preferred;
        probe.close(() => resolve(selected));
      });
    };
    tryPort(preferred);
  });
}

function showStartupError(error) {
  const message = error instanceof Error ? error.message : String(error || "Erro desconhecido");
  const detail = `O HostDeck não conseguiu iniciar.\n\n${message}\n\nLog: ${logFilePath()}`;
  logMessage("ERROR", detail, error instanceof Error ? error.stack || "" : "");
  try { dialog.showErrorBox("HostDeck — falha ao iniciar", detail); } catch {}
}

function updaterConfigPath() {
  return path.join(process.resourcesPath || "", "app-update.yml");
}

function updaterConfigured() {
  return app.isPackaged && fs.existsSync(updaterConfigPath());
}

let updateState = {
  state: app.isPackaged ? "idle" : "unavailable",
  currentVersion: app.getVersion(),
  message: app.isPackaged
    ? "A configuração do canal de atualização será verificada ao abrir o aplicativo."
    : "Atualizações via GitHub Releases ficam disponíveis no aplicativo empacotado.",
  releaseNotes: [],
  releaseVersion: undefined,
  releaseUrl: undefined,
  releasePublishedAt: undefined,
};

function appIconPath() {
  const iconFile = process.platform === "win32" ? "icon.ico" : process.platform === "darwin" ? "icon.icns" : "icon.png";
  const preferred = path.join(__dirname, "..", "build", iconFile);
  if (fs.existsSync(preferred)) return preferred;
  return path.join(__dirname, "..", "build", "icon.png");
}

function notificationIconPath() {
  const png = path.join(__dirname, "..", "build", "icon.png");
  return fs.existsSync(png) ? png : appIconPath();
}

function windowsRelaunchCommand() {
  if (process.platform !== "win32") return process.execPath;
  if (app.isPackaged) return `"${process.execPath}"`;
  return `"${process.execPath}" "${app.getAppPath()}"`;
}

function removeStaleElectronShortcuts() {
  if (process.platform !== "win32") return [];
  const appData = process.env.APPDATA || app.getPath("appData");
  const locations = [
    app.getPath("desktop"),
    path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(appData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"),
  ];
  const removed = [];
  const inspect = (dir, depth = 0) => {
    if (depth > 2 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        inspect(full, depth + 1);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".lnk")) continue;
      try {
        const details = shell.readShortcutLink(full);
        const target = String(details.target || "").toLowerCase();
        const isDevElectron = target.endsWith("\\electron.exe") && target.includes("\\node_modules\\electron\\");
        if (isDevElectron) {
          fs.rmSync(full, { force: true });
          removed.push(full);
        }
      } catch {}
    }
  };
  for (const dir of locations) inspect(dir);
  if (removed.length) logMessage("INFO", "Atalhos antigos do Electron removidos", removed);
  return removed;
}

function repairWindowsShortcuts() {
  if (process.platform !== "win32" || !app.isPackaged) return { ok: false, reason: "not-packaged-windows" };

  const executable = process.execPath;
  const details = {
    target: executable,
    cwd: path.dirname(executable),
    args: "",
    description: "HostDeck Infrastructure Control Center",
    icon: executable,
    iconIndex: 0,
    appUserModelId: PROD_APP_ID,
  };

  const startMenuRoot = path.join(
    process.env.APPDATA || app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
  );
  const desktopRoot = app.getPath("desktop");
  const shortcuts = [
    path.join(startMenuRoot, "HostDeck", "HostDeck.lnk"),
    path.join(desktopRoot, "HostDeck.lnk"),
  ];

  const removed = removeStaleElectronShortcuts();
  const results = [];
  for (const shortcut of shortcuts) {
    try {
      fs.mkdirSync(path.dirname(shortcut), { recursive: true });
      const ok = shell.writeShortcutLink(shortcut, "create", details);
      results.push({ shortcut, ok });
    } catch (error) {
      results.push({ shortcut, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  logMessage("INFO", "Atalhos Windows verificados", { executable, appUserModelId: PROD_APP_ID, removed, results });
  return { ok: results.every((item) => item.ok), executable, appUserModelId: PROD_APP_ID, removed, results };
}

function applyWindowsWindowIdentity(win) {
  if (process.platform !== "win32" || !win || win.isDestroyed()) return;
  try {
    win.setAppDetails({
      appId: APP_ID,
      appIconPath: app.isPackaged ? process.execPath : appIconPath(),
      appIconIndex: 0,
      relaunchCommand: windowsRelaunchCommand(),
      relaunchDisplayName: app.isPackaged ? APP_NAME : `${APP_NAME} Dev`,
    });
  } catch (error) {
    logMessage("ERROR", "Falha ao aplicar identidade nativa da janela", error);
  }
  try { win.setThumbnailToolTip(APP_NAME); } catch {}
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equal = line.indexOf("=");
    if (equal < 1) continue;
    const key = line.slice(0, equal).trim();
    let value = line.slice(equal + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
}

function credentialFile() {
  return path.join(app.getPath("userData"), ".env.local");
}

function preferencesFile() {
  return path.join(app.getPath("userData"), "preferences.json");
}

function monitorHistoryFile() {
  return path.join(app.getPath("userData"), "monitor-history.json");
}

function recoveryStateFile() {
  return path.join(app.getPath("userData"), "recovery-state.json");
}

function notificationStateFile() {
  return path.join(app.getPath("userData"), "notification-state.json");
}

function mediaDirectory() {
  const dir = path.join(app.getPath("userData"), "media");
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function credentialsEnv() {
  const projectEnv = parseEnvFile(path.join(process.cwd(), ".env.local"));
  const desktopEnv = parseEnvFile(credentialFile());
  return { ...projectEnv, ...desktopEnv };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function getPreferences() {
  const saved = readJson(preferencesFile(), {});
  return {
    aiMonitoringEnabled: saved.aiMonitoringEnabled !== false,
    smartAnalysisEnabled: saved.smartAnalysisEnabled !== false,
    autoRecoveryEnabled: saved.autoRecoveryEnabled === true,
    notifyInfoChanges: saved.notifyInfoChanges === true,
    monitorIntervalSeconds: clampNumber(saved.monitorIntervalSeconds, 60, 3600, DEFAULT_MONITOR_SECONDS),
    notificationCooldownMinutes: clampNumber(saved.notificationCooldownMinutes, 5, 120, DEFAULT_NOTIFICATION_COOLDOWN_MINUTES),
    geminiCooldownMinutes: clampNumber(saved.geminiCooldownMinutes, 2, 120, DEFAULT_GEMINI_COOLDOWN_MINUTES),
    recoveryCooldownMinutes: clampNumber(saved.recoveryCooldownMinutes, 5, 180, DEFAULT_RECOVERY_COOLDOWN_MINUTES),
    maxRecoveryAttemptsPerHour: clampNumber(saved.maxRecoveryAttemptsPerHour, 1, 5, DEFAULT_MAX_RECOVERY_ATTEMPTS_PER_HOUR),
    discordNotificationsEnabled: saved.discordNotificationsEnabled !== false,
    discordStatusGraphEnabled: saved.discordStatusGraphEnabled !== false,
    discordRichPresenceEnabled: saved.discordRichPresenceEnabled === true,
    discordRichPresenceClientId: String(saved.discordRichPresenceClientId || "").trim(),
    automaticUpdatesEnabled: saved.automaticUpdatesEnabled !== false,
    automaticUpdateDownload: saved.automaticUpdateDownload !== false,
    updateCheckMinutes: clampNumber(saved.updateCheckMinutes, 10, 360, DEFAULT_UPDATE_CHECK_MINUTES),
    backgroundModeEnabled: saved.backgroundModeEnabled !== false,
    launchAtLogin: saved.launchAtLogin === true,
  };
}

function savePreferences(patch = {}) {
  const current = getPreferences();
  const next = { ...current };
  for (const key of ["aiMonitoringEnabled", "smartAnalysisEnabled", "autoRecoveryEnabled", "notifyInfoChanges", "discordNotificationsEnabled", "discordStatusGraphEnabled", "discordRichPresenceEnabled", "automaticUpdatesEnabled", "automaticUpdateDownload", "backgroundModeEnabled", "launchAtLogin"]) {
    if (typeof patch[key] === "boolean") next[key] = patch[key];
  }
  if (patch.monitorIntervalSeconds != null) next.monitorIntervalSeconds = clampNumber(patch.monitorIntervalSeconds, 60, 3600, DEFAULT_MONITOR_SECONDS);
  if (patch.notificationCooldownMinutes != null) next.notificationCooldownMinutes = clampNumber(patch.notificationCooldownMinutes, 5, 120, DEFAULT_NOTIFICATION_COOLDOWN_MINUTES);
  if (patch.geminiCooldownMinutes != null) next.geminiCooldownMinutes = clampNumber(patch.geminiCooldownMinutes, 2, 120, DEFAULT_GEMINI_COOLDOWN_MINUTES);
  if (patch.recoveryCooldownMinutes != null) next.recoveryCooldownMinutes = clampNumber(patch.recoveryCooldownMinutes, 5, 180, DEFAULT_RECOVERY_COOLDOWN_MINUTES);
  if (patch.maxRecoveryAttemptsPerHour != null) next.maxRecoveryAttemptsPerHour = clampNumber(patch.maxRecoveryAttemptsPerHour, 1, 5, DEFAULT_MAX_RECOVERY_ATTEMPTS_PER_HOUR);
  if (patch.updateCheckMinutes != null) next.updateCheckMinutes = clampNumber(patch.updateCheckMinutes, 10, 360, DEFAULT_UPDATE_CHECK_MINUTES);
  if (Object.prototype.hasOwnProperty.call(patch, "discordRichPresenceClientId")) next.discordRichPresenceClientId = String(patch.discordRichPresenceClientId || "").replace(/[^0-9]/g, "").slice(0, 32);
  writeJson(preferencesFile(), next);
  return next;
}

function configStatus() {
  const env = credentialsEnv();
  const prefs = getPreferences();
  const plugins = {};
  for (const [id, required] of Object.entries(REQUIRED_PLUGIN_FIELDS)) {
    const mapping = PLUGIN_ENV_FIELDS[id] || {};
    const publicValues = {};
    for (const [field, envName] of Object.entries(mapping)) {
      if (!["apiKey", "token", "password", "appPassword"].includes(field)) publicValues[field] = env[envName] || "";
    }
    plugins[id] = { configured: required.every((key) => Boolean(env[key])), values: publicValues };
  }
  return {
    squareConfigured: Boolean(env.SQUARECLOUD_API_KEY),
    vercelConfigured: Boolean(env.VERCEL_TOKEN),
    vercelTeamId: env.VERCEL_TEAM_ID || "",
    geminiConfigured: Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY),
    geminiModel: env.GEMINI_MODEL || "gemini-3.8-flash",
    discordConfigured: Boolean(env.DISCORD_WEBHOOK_URL),
    discordNotificationsEnabled: prefs.discordNotificationsEnabled,
    discordStatusGraphEnabled: prefs.discordStatusGraphEnabled,
    discordRichPresenceEnabled: prefs.discordRichPresenceEnabled,
    discordRichPresenceClientId: prefs.discordRichPresenceClientId,
    plugins,
    aiMonitoringEnabled: prefs.aiMonitoringEnabled,
    smartAnalysisEnabled: prefs.smartAnalysisEnabled,
    autoRecoveryEnabled: prefs.autoRecoveryEnabled,
    notifyInfoChanges: prefs.notifyInfoChanges,
    monitorIntervalSeconds: prefs.monitorIntervalSeconds,
    notificationCooldownMinutes: prefs.notificationCooldownMinutes,
    geminiCooldownMinutes: prefs.geminiCooldownMinutes,
    recoveryCooldownMinutes: prefs.recoveryCooldownMinutes,
    maxRecoveryAttemptsPerHour: prefs.maxRecoveryAttemptsPerHour,
    automaticUpdatesEnabled: prefs.automaticUpdatesEnabled,
    automaticUpdateDownload: prefs.automaticUpdateDownload,
    updateCheckMinutes: prefs.updateCheckMinutes,
    backgroundModeEnabled: prefs.backgroundModeEnabled,
    launchAtLogin: prefs.launchAtLogin,
    credentialPath: credentialFile(),
  };
}

function envLine(value) {
  return String(value ?? "").replace(/[\r\n]/g, "").trim();
}

function writeCredentialEnv(current) {
  const allowed = [
    "SQUARECLOUD_API_KEY", "VERCEL_TOKEN", "VERCEL_TEAM_ID", "RENDER_API_KEY", "NETLIFY_TOKEN",
    "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "DIGITALOCEAN_TOKEN", "HEROKU_API_KEY",
    "DISCLOUD_API_TOKEN", "NEXTCLOUD_URL", "NEXTCLOUD_USERNAME", "NEXTCLOUD_APP_PASSWORD", "NEXTCLOUD_ROOT_PATH",
    "GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_MODEL", "DISCORD_WEBHOOK_URL",
  ];
  fs.mkdirSync(path.dirname(credentialFile()), { recursive: true });
  const body = ["# HostDeck - credenciais locais. Não envie este arquivo para o GitHub."];
  for (const key of allowed) if (current[key]) body.push(`${key}=${envLine(current[key])}`);
  body.push("");
  fs.writeFileSync(credentialFile(), body.join("\n"), { encoding: "utf8", mode: 0o600 });
}

function savePluginConfig(input = {}) {
  const id = String(input.id || "");
  const mapping = PLUGIN_ENV_FIELDS[id];
  if (!mapping) throw new Error("Plugin desconhecido");
  const current = credentialsEnv();
  const values = input.values && typeof input.values === "object" ? input.values : {};
  for (const [field, envName] of Object.entries(mapping)) {
    if (!Object.prototype.hasOwnProperty.call(values, field)) continue;
    const value = envLine(values[field]);
    if (value) current[envName] = value;
    else if (!["apiKey", "token", "password", "appPassword"].includes(field)) delete current[envName];
  }
  if (input.remove === true) {
    for (const envName of Object.values(mapping)) delete current[envName];
  }
  writeCredentialEnv(current);
  return configStatus();
}

function saveCredentials(input = {}) {
  const current = credentialsEnv();
  const square = envLine(input.squareToken);
  const vercel = envLine(input.vercelToken);
  const team = envLine(input.vercelTeamId);
  const gemini = envLine(input.geminiKey);
  const geminiModel = envLine(input.geminiModel);
  const discordWebhook = envLine(input.discordWebhookUrl);

  if (square) current.SQUARECLOUD_API_KEY = square;
  if (vercel) current.VERCEL_TOKEN = vercel;
  if (gemini) current.GEMINI_API_KEY = gemini;
  if (geminiModel) current.GEMINI_MODEL = geminiModel;
  if (discordWebhook) current.DISCORD_WEBHOOK_URL = discordWebhook;
  if (Object.prototype.hasOwnProperty.call(input, "vercelTeamId")) {
    if (team) current.VERCEL_TEAM_ID = team;
    else delete current.VERCEL_TEAM_ID;
  }
  if (input.removeSquare === true) delete current.SQUARECLOUD_API_KEY;
  if (input.removeVercel === true) { delete current.VERCEL_TOKEN; delete current.VERCEL_TEAM_ID; }
  if (input.removeGemini === true) { delete current.GEMINI_API_KEY; delete current.GOOGLE_API_KEY; }
  if (input.removeDiscord === true) delete current.DISCORD_WEBHOOK_URL;

  savePreferences({
    aiMonitoringEnabled: input.aiMonitoringEnabled,
    smartAnalysisEnabled: input.smartAnalysisEnabled,
    autoRecoveryEnabled: input.autoRecoveryEnabled,
    notifyInfoChanges: input.notifyInfoChanges,
    monitorIntervalSeconds: input.monitorIntervalSeconds,
    notificationCooldownMinutes: input.notificationCooldownMinutes,
    geminiCooldownMinutes: input.geminiCooldownMinutes,
    recoveryCooldownMinutes: input.recoveryCooldownMinutes,
    maxRecoveryAttemptsPerHour: input.maxRecoveryAttemptsPerHour,
    discordNotificationsEnabled: input.discordNotificationsEnabled,
    discordStatusGraphEnabled: input.discordStatusGraphEnabled,
    discordRichPresenceEnabled: input.discordRichPresenceEnabled,
    discordRichPresenceClientId: input.discordRichPresenceClientId,
    automaticUpdatesEnabled: input.automaticUpdatesEnabled,
    automaticUpdateDownload: input.automaticUpdateDownload,
    updateCheckMinutes: input.updateCheckMinutes,
    backgroundModeEnabled: input.backgroundModeEnabled,
    launchAtLogin: input.launchAtLogin,
  });
  writeCredentialEnv(current);
  return configStatus();
}

function waitForServer(url, attempts = 160, managedProcess = null) {
  return new Promise((resolve, reject) => {
    let count = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const check = () => {
      if (managedProcess && managedProcess.exitCode != null) {
        return finish(reject, new Error(`O servidor local encerrou antes de iniciar (código ${managedProcess.exitCode}). Consulte ${logFilePath()}`));
      }
      count += 1;
      const req = http.get(url, (res) => {
        res.resume();
        if ((res.statusCode || 500) < 500) return finish(resolve);
        retry();
      });
      req.on("error", retry);
      req.setTimeout(900, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (settled) return;
      if (count >= attempts) return finish(reject, new Error(`O servidor local do HostDeck não iniciou em ${url}. Consulte ${logFilePath()}`));
      setTimeout(check, 250);
    };
    check();
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!nextProcess || nextProcess.killed) {
      nextProcess = null;
      resolve();
      return;
    }
    const proc = nextProcess;
    nextProcess = null;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    proc.once("exit", done);
    try { proc.kill(); } catch { done(); }
    setTimeout(() => {
      try { if (!proc.killed) proc.kill("SIGKILL"); } catch {}
      done();
    }, 1800);
  });
}

async function startProductionServer() {
  const standaloneDir = path.join(process.resourcesPath, "standalone");
  const serverFile = path.join(standaloneDir, "server.js");
  const packageFile = path.join(standaloneDir, "package.json");
  const runtimeModules = path.join(standaloneDir, "runtime_modules");
  const nextPackageFile = path.join(runtimeModules, "next", "package.json");
  if (!fs.existsSync(serverFile)) throw new Error(`Servidor Next.js não encontrado em ${serverFile}`);
  if (!fs.existsSync(packageFile)) throw new Error(`Pacote standalone incompleto: ${packageFile} não existe.`);
  if (!fs.existsSync(nextPackageFile)) {
    throw new Error(`Runtime do Next.js não encontrado em ${nextPackageFile}. Gere novamente o instalador com a versão 1.4.6 ou superior.`);
  }

  runtimePort = await getFreePort(PREFERRED_PORT);
  logMessage("INFO", "Iniciando servidor standalone", { serverFile, standaloneDir, runtimeModules, runtimePort, resourcesPath: process.resourcesPath });
  const output = ensureLogStream();
  const nodePath = [runtimeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);

  nextProcess = spawn(process.execPath, [serverFile], {
    cwd: standaloneDir,
    windowsHide: true,
    env: {
      ...process.env,
      ...credentialsEnv(),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      NODE_PATH: nodePath,
      HOSTNAME: "127.0.0.1",
      PORT: String(runtimePort),
      HOSTDECK_MEDIA_DIR: mediaDirectory(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (nextProcess.stdout) nextProcess.stdout.on("data", (chunk) => { try { output.write(chunk); } catch {} });
  if (nextProcess.stderr) nextProcess.stderr.on("data", (chunk) => { try { output.write(chunk); } catch {} });

  const spawned = nextProcess;
  spawned.on("error", (error) => logMessage("ERROR", "Falha ao criar processo do servidor", error));
  spawned.on("exit", (code, signal) => {
    logMessage(code === 0 ? "INFO" : "ERROR", "Servidor local encerrou", { code, signal });
    if (nextProcess === spawned) nextProcess = null;
  });

  const url = `http://127.0.0.1:${runtimePort}`;
  await waitForServer(url, 160, spawned);
  logMessage("INFO", "Servidor standalone pronto", url);
  return url;
}

async function startDevelopmentServer() {
  const nextBin = require.resolve("next/dist/bin/next");
  runtimePort = await getFreePort(PREFERRED_PORT);
  nextProcess = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", String(runtimePort)], {
    cwd: process.cwd(),
    windowsHide: true,
    env: {
      ...process.env,
      ...credentialsEnv(),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "development",
      HOSTDECK_MEDIA_DIR: mediaDirectory(),
    },
    stdio: "inherit",
  });
  const url = `http://127.0.0.1:${runtimePort}`;
  await waitForServer(url, 160, nextProcess);
  return url;
}

async function ensureServer() {
  if (DEV_URL) return DEV_URL;
  if (!app.isPackaged || FORCE_DEV_SERVER) return startDevelopmentServer();
  return startProductionServer();
}

async function restartManagedServer() {
  if (DEV_URL) return DEV_URL;
  await stopServer();
  serverUrl = await ensureServer();
  return serverUrl;
}

function sendUpdateState(patch) {
  updateState = { ...updateState, ...patch, currentVersion: app.getVersion() };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updates:status", updateState);
}

function githubReleaseBodyLines(body) {
  return String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 80);
}

async function hydrateLatestReleaseNotes() {
  if (!HOSTDECK_RELEASE_REPOSITORY || !HOSTDECK_RELEASE_REPOSITORY.includes("/")) return;
  try {
    const response = await fetch(`https://api.github.com/repos/${HOSTDECK_RELEASE_REPOSITORY}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `HostDeck/${app.getVersion()}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (!response.ok) return;
    const release = await response.json();
    const notes = githubReleaseBodyLines(release?.body);
    if (!notes.length) return;
    if (["available", "downloading", "downloaded"].includes(updateState.state)) return;
    sendUpdateState({
      releaseNotes: notes,
      releaseVersion: String(release?.tag_name || "").replace(/^v/i, "") || app.getVersion(),
      releaseUrl: release?.html_url || undefined,
      releasePublishedAt: release?.published_at || undefined,
    });
  } catch (error) {
    logMessage("INFO", "Não foi possível carregar o changelog público do GitHub", error instanceof Error ? error.message : String(error));
  }
}

function friendlyUpdaterError(error) {
  const raw = error?.message || String(error || "Falha ao verificar atualização.");
  if (/404|releases\.atom|github\.com/i.test(raw)) {
    return "O repositório do HostDeck foi encontrado, mas o GitHub não expôs uma release pública para o updater. Releases em Draft não aparecem para os usuários. Publique a release no GitHub; builds novos do HostDeck já são configurados para publicar como Release automaticamente.";
  }
  if (/401|403|authentication|token/i.test(raw)) {
    return "O GitHub recusou a consulta de atualização. Verifique as permissões/publicidade do repositório de releases. Não coloque um token pessoal dentro do aplicativo distribuído.";
  }
  return raw;
}

function showDesktopNotification(title, body, onClick) {
  if (!Notification.isSupported()) return;
  try {
    const notification = new Notification({
      title,
      body: String(body || "").slice(0, 600),
      icon: notificationIconPath(),
      silent: false,
    });
    if (onClick) notification.on("click", onClick);
    notification.show();
  } catch {}
}

function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function checkForUpdatesAutomatic() {
  const prefs = getPreferences();
  if (!app.isPackaged || !updaterConfigured() || !prefs.automaticUpdatesEnabled) return;
  if (["checking", "downloading", "downloaded"].includes(updateState.state)) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    sendUpdateState({ state: "error", message: friendlyUpdaterError(error) });
  }
}

function startUpdateLoop() {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  updateCheckTimer = null;
  const prefs = getPreferences();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  if (!app.isPackaged || !updaterConfigured() || !prefs.automaticUpdatesEnabled) return;
  setTimeout(() => checkForUpdatesAutomatic().catch(() => {}), 8000);
  updateCheckTimer = setInterval(() => checkForUpdatesAutomatic().catch(() => {}), prefs.updateCheckMinutes * 60 * 1000);
}

function configureUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => sendUpdateState({ state: "checking", message: "Consultando a versão mais recente no GitHub…" }));
  autoUpdater.on("update-available", (info) => {
    const releaseNotes = Array.isArray(info.releaseNotes)
      ? info.releaseNotes.map((item) => typeof item === "string" ? item : item?.note || item?.version || "").filter(Boolean)
      : info.releaseNotes
        ? [String(info.releaseNotes)]
        : [];
    playAttentionSound(2);
    sendUpdateState({ state: "available", availableVersion: info.version, percent: 0, message: `Versão ${info.version} disponível.`, releaseNotes });
    showDesktopNotification(
      `HostDeck ${info.version} disponível`,
      getPreferences().automaticUpdateDownload ? "A atualização será baixada automaticamente em segundo plano." : "Abra o HostDeck para baixar a nova versão.",
      revealMainWindow,
    );
    if (getPreferences().automaticUpdateDownload) {
      setTimeout(() => autoUpdater.downloadUpdate().catch((error) => sendUpdateState({ state: "error", message: friendlyUpdaterError(error) })), 500);
    }
  });
  autoUpdater.on("update-not-available", () => { sendUpdateState({ state: "up-to-date", availableVersion: undefined, percent: undefined, message: "Você já está usando a versão mais recente." }); hydrateLatestReleaseNotes().catch(() => {}); });
  autoUpdater.on("download-progress", (progress) => sendUpdateState({ state: "downloading", percent: progress.percent, message: `Baixando atualização: ${Math.round(progress.percent)}%` }));
  autoUpdater.on("update-downloaded", (info) => {
    const releaseNotes = Array.isArray(info.releaseNotes)
      ? info.releaseNotes.map((item) => typeof item === "string" ? item : item?.note || item?.version || "").filter(Boolean)
      : info.releaseNotes
        ? [String(info.releaseNotes)]
        : updateState.releaseNotes || [];
    playAttentionSound(3);
    sendUpdateState({ state: "downloaded", availableVersion: info.version, percent: 100, message: "Atualização baixada. Ela será instalada quando o HostDeck sair ou você pode instalar agora.", releaseNotes });
    showDesktopNotification(`HostDeck ${info.version} pronto para instalar`, "A atualização foi baixada. Clique para abrir o HostDeck e instalar agora, ou ela será aplicada ao encerrar o aplicativo.", revealMainWindow);
  });
  autoUpdater.on("error", (error) => sendUpdateState({ state: "error", message: friendlyUpdaterError(error) }));

  hydrateLatestReleaseNotes().catch(() => {});

  if (app.isPackaged && !updaterConfigured()) {
    sendUpdateState({
      state: "unavailable",
      message: "Este instalador foi gerado como build local e não possui canal GitHub embutido. Publique uma release pelo GitHub Actions para habilitar atualizações automáticas.",
    });
  } else if (app.isPackaged) {
    sendUpdateState({ state: "idle", message: "Atualizações automáticas prontas. O HostDeck verifica ao iniciar e periodicamente enquanto estiver em execução." });
  }
}

function applyLoginItemSetting() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const prefs = getPreferences();
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(prefs.launchAtLogin),
      path: process.execPath,
      args: prefs.backgroundModeEnabled ? ["--background"] : [],
    });
  } catch (error) {
    logMessage("ERROR", "Falha ao configurar inicialização com o Windows", error);
  }
}

function discordRpcFrame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function closeDiscordRpc() {
  if (discordRpcReconnectTimer) clearTimeout(discordRpcReconnectTimer);
  discordRpcReconnectTimer = null;
  discordRpcReady = false;
  discordRpcBuffer = Buffer.alloc(0);
  if (discordRpcSocket) {
    try { discordRpcSocket.destroy(); } catch {}
  }
  discordRpcSocket = null;
}

function discordActivityPayload() {
  const prefs = getPreferences();
  if (!prefs.discordRichPresenceEnabled || !prefs.discordRichPresenceClientId) return null;
  const current = discordRpcActivity || {};
  const selectedProvider = current.provider ? String(current.provider) : "";
  const selectedProviderName = current.providerName ? String(current.providerName) : selectedProvider;
  const appName = current.appName ? String(current.appName) : "";
  const status = current.status ? String(current.status) : "";
  const startedAt = Math.floor(Number(current.startedAt || Date.now()) / 1000);
  const assets = appName
    ? { large_image: selectedProvider || "hostdeck", large_text: appName, small_image: "hostdeck", small_text: "HostDeck" }
    : selectedProvider
      ? { large_image: selectedProvider, large_text: selectedProviderName || selectedProvider, small_image: "hostdeck", small_text: "HostDeck" }
      : { large_image: "hostdeck", large_text: "HostDeck" };
  return {
    details: appName || (selectedProviderName ? `Hospedagem: ${selectedProviderName}` : "Infrastructure Control Center"),
    state: appName ? `${selectedProviderName || selectedProvider}${status ? ` · ${status}` : ""}` : selectedProviderName ? "Gerenciando aplicações" : "Monitorando infraestrutura",
    timestamps: { start: startedAt },
    assets,
    instance: false,
  };
}

function sendDiscordRpcActivity() {
  if (!discordRpcSocket || !discordRpcReady || discordRpcSocket.destroyed) return false;
  const activity = discordActivityPayload();
  const payload = {
    cmd: "SET_ACTIVITY",
    args: { pid: process.pid, activity },
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  try {
    discordRpcSocket.write(discordRpcFrame(1, payload));
    return true;
  } catch {
    return false;
  }
}

function scheduleDiscordRpcReconnect() {
  const prefs = getPreferences();
  if (!prefs.discordRichPresenceEnabled || !prefs.discordRichPresenceClientId || isQuitting) return;
  if (discordRpcReconnectTimer) clearTimeout(discordRpcReconnectTimer);
  discordRpcReconnectTimer = setTimeout(() => {
    discordRpcReconnectTimer = null;
    connectDiscordRpc();
  }, 8000);
}

function attachDiscordRpcSocket(socket, clientId) {
  discordRpcSocket = socket;
  discordRpcReady = false;
  discordRpcBuffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    discordRpcBuffer = Buffer.concat([discordRpcBuffer, chunk]);
    while (discordRpcBuffer.length >= 8) {
      const op = discordRpcBuffer.readInt32LE(0);
      const length = discordRpcBuffer.readInt32LE(4);
      if (discordRpcBuffer.length < 8 + length) break;
      const body = discordRpcBuffer.subarray(8, 8 + length);
      discordRpcBuffer = discordRpcBuffer.subarray(8 + length);
      if (op !== 1) continue;
      try {
        const message = JSON.parse(body.toString("utf8"));
        if (message?.evt === "READY") {
          discordRpcReady = true;
          sendDiscordRpcActivity();
        }
      } catch {}
    }
  });
  socket.on("error", () => {});
  socket.on("close", () => {
    if (discordRpcSocket === socket) {
      discordRpcSocket = null;
      discordRpcReady = false;
      scheduleDiscordRpcReconnect();
    }
  });
  socket.write(discordRpcFrame(0, { v: 1, client_id: clientId }));
}

function connectDiscordRpc() {
  const prefs = getPreferences();
  if (!prefs.discordRichPresenceEnabled || !prefs.discordRichPresenceClientId) {
    closeDiscordRpc();
    return;
  }
  if (discordRpcSocket && !discordRpcSocket.destroyed) {
    sendDiscordRpcActivity();
    return;
  }
  if (process.platform !== "win32") return;
  const candidates = Array.from({ length: 10 }, (_, index) => `\\\\?\\pipe\\discord-ipc-${index}`);
  const tryPipe = (index) => {
    if (index >= candidates.length) {
      scheduleDiscordRpcReconnect();
      return;
    }
    const socket = net.createConnection(candidates[index]);
    let connected = false;
    socket.once("connect", () => {
      connected = true;
      attachDiscordRpcSocket(socket, prefs.discordRichPresenceClientId);
    });
    socket.once("error", () => {
      if (!connected) {
        try { socket.destroy(); } catch {}
        tryPipe(index + 1);
      }
    });
  };
  tryPipe(0);
}

function applyDiscordRpcSettings() {
  const prefs = getPreferences();
  if (!prefs.discordRichPresenceEnabled || !prefs.discordRichPresenceClientId) {
    if (discordRpcSocket && discordRpcReady) {
      try {
        discordRpcSocket.write(discordRpcFrame(1, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity: null }, nonce: `${Date.now()}-clear` }));
      } catch {}
    }
    closeDiscordRpc();
    return;
  }
  connectDiscordRpc();
}

function createTray() {
  if (!app.isPackaged || tray) return;
  try {
    tray = new Tray(appIconPath());
    tray.setToolTip("HostDeck — monitoramento e atualizações em segundo plano");
    tray.on("double-click", revealMainWindow);
    const rebuild = () => {
      tray?.setContextMenu(Menu.buildFromTemplate([
        { label: "Abrir HostDeck", click: revealMainWindow },
        { label: "Verificar atualizações", click: () => checkForUpdatesAutomatic().catch(() => {}) },
        { type: "separator" },
        { label: "Sair do HostDeck", click: () => { isQuitting = true; app.quit(); } },
      ]));
    };
    rebuild();
  } catch (error) {
    logMessage("ERROR", "Falha ao criar ícone da bandeja", error);
  }
}

function monitorState() {
  const prefs = getPreferences();
  const history = readJson(monitorHistoryFile(), []);
  return {
    enabled: prefs.aiMonitoringEnabled,
    intervalSeconds: prefs.monitorIntervalSeconds,
    running: monitorBusy,
    lastCheckedAt: lastMonitorCheckedAt || history[0]?.checkedAt || null,
    lastInsight: history[0] || null,
    history: history.slice(0, 20),
  };
}

function sendMonitorState(extra = {}) {
  const state = { ...monitorState(), ...extra };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("monitor:status", state);
  return state;
}

function persistInsight(insight) {
  const history = readJson(monitorHistoryFile(), []);
  const checkedAt = new Date().toISOString();
  const record = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...insight, checkedAt };
  history.unshift(record);
  writeJson(monitorHistoryFile(), history.slice(0, 80));
  return record;
}

function appMap(snapshot) {
  return new Map((snapshot?.apps || []).map((item) => [`${item.provider}:${item.id}`, item]));
}

function providerMap(snapshot) {
  return new Map((snapshot?.providers || []).map((item) => [item.provider, item]));
}

function detectSnapshotEvents(previous, current) {
  const events = [];
  const nowApps = appMap(current);
  const prevApps = appMap(previous);
  const nowProviders = providerMap(current);
  const prevProviders = providerMap(previous);

  if (!previous) {
    for (const appItem of nowApps.values()) {
      if (["offline", "paused", "error"].includes(appItem.status)) {
        events.push({ type: "problem", provider: appItem.provider, appId: appItem.id, appName: appItem.name, before: null, after: appItem.status, message: `${appItem.name} iniciou o monitoramento em estado ${appItem.status}.` });
      }
    }
    for (const provider of nowProviders.values()) {
      if (provider.error) events.push({ type: "provider_error", provider: provider.provider, message: `${provider.provider}: ${provider.error}` });
    }
    return events;
  }

  for (const [key, now] of nowApps) {
    const before = prevApps.get(key);
    if (!before) {
      events.push({ type: "app_added", provider: now.provider, appId: now.id, appName: now.name, before: null, after: now.status, message: `Nova aplicação detectada: ${now.name} (${now.provider}).` });
      continue;
    }
    if (before.status !== now.status) {
      events.push({ type: "status_changed", provider: now.provider, appId: now.id, appName: now.name, before: before.status, after: now.status, message: `${now.name}: ${before.status} → ${now.status}.` });
    }
    if ((before.url || "") !== (now.url || "")) {
      events.push({ type: "url_changed", provider: now.provider, appId: now.id, appName: now.name, before: before.url || null, after: now.url || null, message: `${now.name}: URL de produção alterada.` });
    }
    if ((before.latestDeploymentId || "") !== (now.latestDeploymentId || "") && (before.latestDeploymentId || now.latestDeploymentId)) {
      events.push({ type: "deployment_changed", provider: now.provider, appId: now.id, appName: now.name, before: before.latestDeploymentId || null, after: now.latestDeploymentId || null, message: `${now.name}: novo deployment detectado em ${now.provider}.` });
    } else if (before.updatedAt && now.updatedAt && before.updatedAt !== now.updatedAt && now.provider !== "square") {
      events.push({ type: "app_updated", provider: now.provider, appId: now.id, appName: now.name, before: before.updatedAt, after: now.updatedAt, message: `${now.name}: metadados/deployment atualizados em ${now.provider}.` });
    }
  }

  for (const [key, before] of prevApps) {
    if (!nowApps.has(key)) {
      events.push({ type: "app_removed", provider: before.provider, appId: before.id, appName: before.name, before: before.status, after: null, message: `Aplicação não aparece mais no provedor: ${before.name}.` });
    }
  }

  for (const [providerName, now] of nowProviders) {
    const before = prevProviders.get(providerName);
    if ((before?.error || "") !== (now.error || "")) {
      events.push({ type: now.error ? "provider_error" : "provider_recovered", provider: providerName, before: before?.error || null, after: now.error || null, message: now.error ? `${providerName}: ${now.error}` : `${providerName}: conexão recuperada.` });
    }
  }
  return events;
}

function fallbackInsight(events, snapshot) {
  const recoveryFailed = events.some((event) => event.type === "auto_recovery_failed");
  const recovered = events.some((event) => event.type === "auto_recovery_success");
  const skipped = events.some((event) => event.type === "auto_recovery_skipped");
  const unresolvedOffline = !recovered && events.some((event) => ["offline", "error"].includes(event.after));
  const critical = recoveryFailed || unresolvedOffline || events.some((event) => event.type === "provider_error");
  const warning = recovered || skipped || events.some((event) => event.after === "paused" || event.type === "app_removed");
  const severity = critical ? "critical" : warning ? "warning" : "info";
  const affectedApps = [...new Set(events.map((event) => event.appName).filter(Boolean))];
  const purpose = events.find((event) => event.appPurpose)?.appPurpose;
  const headline = recoveryFailed
    ? "Recuperação automática não foi confirmada"
    : recovered
      ? "HostDeck recuperou uma aplicação automaticamente"
      : critical
        ? "HostDeck detectou uma falha de infraestrutura"
        : "Alteração detectada na infraestrutura";
  const summaryParts = events.map((event) => event.message).filter(Boolean).slice(0, 4);
  if (purpose) summaryParts.push(`Contexto da aplicação: ${purpose}`);
  return {
    severity,
    headline,
    summary: summaryParts.join(" "),
    affectedApps,
    changes: events.map((event) => event.message),
    recommendations: recoveryFailed
      ? ["Abra os logs da aplicação afetada.", "Confira o status do provedor antes de tentar uma nova ação manual."]
      : recovered
        ? ["Confirme os logs após a recuperação.", "Se a queda se repetir, investigue consumo de recursos e o último deployment."]
        : critical
          ? ["Abra os logs da aplicação afetada.", "Confira o status do provedor e o último deployment."]
          : ["Revise a alteração no HostDeck para confirmar se ela era esperada."],
    source: "local",
    model: null,
    snapshotAt: snapshot?.fetchedAt || Date.now(),
  };
}

async function postJson(url, body, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}


function recoveryKey(provider, appId) {
  return `${provider}:${appId}`;
}

function getRecoveryEntry(provider, appId) {
  const state = readJson(recoveryStateFile(), {});
  const key = recoveryKey(provider, appId);
  return { state, key, entry: state[key] || { attempts: [], lastAttemptAt: 0, suppressUntil: 0 } };
}

function saveRecoveryEntry(state, key, entry) {
  state[key] = entry;
  writeJson(recoveryStateFile(), state);
}

function recordManualAction(input = {}) {
  const provider = String(input.provider || "");
  const appId = String(input.id || "");
  const action = String(input.action || "");
  if (!provider || !appId) return;
  const { state, key, entry } = getRecoveryEntry(provider, appId);
  const now = Date.now();
  if (action === "stop" || action === "pause") {
    entry.suppressUntil = now + 30 * 60 * 1000;
    entry.lastManualAction = action;
    entry.lastManualActionAt = now;
  } else if (action === "start" || action === "resume" || action === "restart") {
    entry.suppressUntil = 0;
    entry.lastManualAction = action;
    entry.lastManualActionAt = now;
  }
  saveRecoveryEntry(state, key, entry);
}

function canAttemptRecovery(appItem, event, prefs) {
  if (!prefs.autoRecoveryEnabled) return { ok: false, reason: "auto-recovery-disabled" };
  if (!event || event.type !== "status_changed" || event.before !== "online" || !["offline", "error"].includes(event.after)) {
    return { ok: false, reason: "not-unexpected-offline" };
  }
  if (!appItem || !Array.isArray(appItem.actions)) return { ok: false, reason: "app-missing" };
  const action = appItem.actions.includes("start") ? "start" : appItem.actions.includes("resume") ? "resume" : null;
  if (!action) return { ok: false, reason: "no-safe-action" };

  const { state, key, entry } = getRecoveryEntry(appItem.provider, appItem.id);
  const now = Date.now();
  const attempts = Array.isArray(entry.attempts) ? entry.attempts.filter((value) => now - Number(value) < 60 * 60 * 1000) : [];
  if (Number(entry.suppressUntil || 0) > now) return { ok: false, reason: "manual-action-suppression", state, key, entry: { ...entry, attempts }, action };
  if (attempts.length >= prefs.maxRecoveryAttemptsPerHour) return { ok: false, reason: "hourly-limit", state, key, entry: { ...entry, attempts }, action };
  if (Number(entry.lastAttemptAt || 0) && now - Number(entry.lastAttemptAt) < prefs.recoveryCooldownMinutes * 60 * 1000) {
    return { ok: false, reason: "recovery-cooldown", state, key, entry: { ...entry, attempts }, action };
  }
  return { ok: true, state, key, entry: { ...entry, attempts }, action };
}

async function fetchAppDetails(provider, appId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${serverUrl}/api/apps/${encodeURIComponent(provider)}/${encodeURIComponent(appId)}/details`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = await response.json().catch(() => ({}));
    return json.details || null;
  } finally {
    clearTimeout(timer);
  }
}

async function attemptAutoRecovery(event, snapshot, prefs) {
  const appItem = (snapshot?.apps || []).find((item) => item.provider === event.provider && item.id === event.appId);
  const eligibility = canAttemptRecovery(appItem, event, prefs);
  if (!eligibility.ok) return null;

  let action = eligibility.action;
  let decision = {
    shouldRecover: true,
    risk: "low",
    appPurpose: appItem.description || `${appItem.name} em ${appItem.provider}`,
    reason: "A aplicação estava online no último snapshot e passou para offline sem uma pausa registrada no HostDeck.",
    recommendedAction: action,
    notify: true,
    summary: `${appItem.name} saiu do estado online inesperadamente.`,
    source: "local",
  };

  if (prefs.smartAnalysisEnabled && configStatus().geminiConfigured) {
    try {
      const ai = await postJson(`${serverUrl}/api/ai/analyze`, {
        mode: "recovery",
        app: appItem,
        event,
        previousStatus: event.before,
        currentStatus: event.after,
        snapshot: { apps: [appItem], providers: snapshot.providers || [] },
      }, 40000);
      lastGeminiAnalyzeAt = Date.now();
      decision = { ...decision, ...ai, source: "gemini" };
    } catch (error) {
      decision = { ...decision, reason: `${decision.reason} O Gemini não pôde ser consultado: ${error instanceof Error ? error.message : "falha desconhecida"}.`, source: "local" };
    }
  }

  if (!decision.shouldRecover) {
    return {
      type: "auto_recovery_skipped",
      provider: appItem.provider,
      appId: appItem.id,
      appName: appItem.name,
      before: event.after,
      after: event.after,
      message: `${appItem.name}: recuperação automática não executada. ${decision.reason}`,
      appPurpose: decision.appPurpose,
      recoveryReason: decision.reason,
      aiDecision: decision.source,
    };
  }

  if (decision.recommendedAction && decision.recommendedAction !== "none" && appItem.actions.includes(decision.recommendedAction)) {
    action = decision.recommendedAction;
  }
  if (!action || !appItem.actions.includes(action)) {
    return {
      type: "auto_recovery_skipped",
      provider: appItem.provider,
      appId: appItem.id,
      appName: appItem.name,
      before: event.after,
      after: event.after,
      message: `${appItem.name}: a análise recomendou uma ação que este plugin não suporta.`,
      appPurpose: decision.appPurpose,
      recoveryReason: decision.reason,
      aiDecision: decision.source,
    };
  }

  const now = Date.now();
  const entry = eligibility.entry;
  entry.attempts = [...(entry.attempts || []), now];
  entry.lastAttemptAt = now;
  entry.lastAction = action;
  saveRecoveryEntry(eligibility.state, eligibility.key, entry);

  try {
    await postJson(`${serverUrl}/api/apps/${encodeURIComponent(appItem.provider)}/${encodeURIComponent(appItem.id)}/action`, { action }, 25000);
    let details = null;
    let recovered = false;
    for (let i = 0; i < 6; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, i === 0 ? 2200 : 2800));
      details = await fetchAppDetails(appItem.provider, appItem.id).catch(() => null);
      if (details && details.status === "online") {
        recovered = true;
        break;
      }
    }
    if (recovered) {
      appItem.status = "online";
      if (details?.actions) appItem.actions = details.actions;
      return {
        type: "auto_recovery_success",
        provider: appItem.provider,
        appId: appItem.id,
        appName: appItem.name,
        before: event.after,
        after: "online",
        message: `${appItem.name}: HostDeck executou ${action} e confirmou o retorno para online.`,
        appPurpose: decision.appPurpose,
        recoveryReason: decision.reason,
        aiDecision: decision.source,
      };
    }
    return {
      type: "auto_recovery_failed",
      provider: appItem.provider,
      appId: appItem.id,
      appName: appItem.name,
      before: event.after,
      after: appItem.status,
      message: `${appItem.name}: o comando ${action} foi enviado, mas o estado online não foi confirmado dentro da janela de recuperação.`,
      appPurpose: decision.appPurpose,
      recoveryReason: decision.reason,
      aiDecision: decision.source,
    };
  } catch (error) {
    return {
      type: "auto_recovery_failed",
      provider: appItem.provider,
      appId: appItem.id,
      appName: appItem.name,
      before: event.after,
      after: appItem.status,
      message: `${appItem.name}: falha ao executar recuperação automática (${error instanceof Error ? error.message : "erro desconhecido"}).`,
      appPurpose: decision.appPurpose,
      recoveryReason: decision.reason,
      aiDecision: decision.source,
    };
  }
}

function eventIsNotable(event) {
  if (!event) return false;
  if (["provider_error", "app_removed", "auto_recovery_success", "auto_recovery_failed", "auto_recovery_skipped"].includes(event.type)) return true;
  if (event.type === "status_changed" && ["offline", "error"].includes(event.after)) return true;
  return false;
}

function eventFingerprint(events) {
  return events
    .map((event) => [event.type, event.provider, event.appId || "", event.before || "", event.after || ""].join(":"))
    .sort()
    .join("|")
    .slice(0, 3000);
}

function notificationAllowed(events, prefs) {
  if (!events.length) return false;
  if (!prefs.notifyInfoChanges && !events.some(eventIsNotable)) return false;
  const fingerprint = eventFingerprint(events);
  const state = readJson(notificationStateFile(), {});
  const now = Date.now();
  const last = Number(state[fingerprint] || 0);
  if (last && now - last < prefs.notificationCooldownMinutes * 60 * 1000) return false;
  return true;
}

function recordNotification(events) {
  const fingerprint = eventFingerprint(events);
  if (!fingerprint) return;
  const state = readJson(notificationStateFile(), {});
  const now = Date.now();
  state[fingerprint] = now;
  for (const [key, value] of Object.entries(state)) {
    if (now - Number(value) > 24 * 60 * 60 * 1000) delete state[key];
  }
  writeJson(notificationStateFile(), state);
}

function geminiSummaryAllowed(prefs) {
  if (!prefs.smartAnalysisEnabled || !configStatus().geminiConfigured) return false;
  return !lastGeminiAnalyzeAt || Date.now() - lastGeminiAnalyzeAt >= prefs.geminiCooldownMinutes * 60 * 1000;
}

function discordStatusFields(snapshot) {
  const apps = Array.isArray(snapshot?.apps) ? snapshot.apps : [];
  if (!apps.length) return [];
  const statuses = ["online", "building", "paused", "offline", "error", "unknown"];
  const labels = { online: "Online", building: "Build", paused: "Pausado", offline: "Offline", error: "Erro", unknown: "Indef." };
  const icons = { online: "🟢", building: "🔵", paused: "🟡", offline: "⚫", error: "🔴", unknown: "⚪" };
  const graph = statuses.map((status) => {
    const count = apps.filter((app) => app.status === status).length;
    const width = count ? Math.max(1, Math.round((count / apps.length) * 12)) : 0;
    return `${icons[status]} ${String(labels[status]).padEnd(7)} ${"█".repeat(width)}${"░".repeat(12 - width)} ${count}`;
  }).join("\n");
  const byProvider = new Map();
  for (const appItem of apps) {
    const current = byProvider.get(appItem.provider) || { total: 0, online: 0 };
    current.total += 1;
    if (appItem.status === "online") current.online += 1;
    byProvider.set(appItem.provider, current);
  }
  const providers = [...byProvider.entries()].map(([name, value]) => `• ${name}: ${value.online}/${value.total} online`).join("\n");
  return [
    { name: `Status geral · ${apps.length} apps`, value: `\`\`\`text\n${graph}\n\`\`\``, inline: false },
    { name: "Hospedagens", value: providers.slice(0, 1000), inline: false },
  ];
}

async function sendDiscordInsight(record) {
  const env = credentialsEnv();
  const prefs = getPreferences();
  if (!prefs.discordNotificationsEnabled || !env.DISCORD_WEBHOOK_URL) return;
  const color = record.severity === "critical" ? 15548997 : record.severity === "warning" ? 16753920 : record.severity === "healthy" ? 5763719 : 5793266;
  const fields = [];
  if (prefs.discordStatusGraphEnabled) fields.push(...discordStatusFields(previousSnapshot));
  if (record.affectedApps?.length) fields.push({ name: "Aplicações", value: record.affectedApps.slice(0, 8).join(", "), inline: false });
  if (record.changes?.length) fields.push({ name: "Mudanças", value: record.changes.slice(0, 5).map((item) => `• ${item}`).join("\n").slice(0, 1000), inline: false });
  if (record.recommendations?.length) fields.push({ name: "Recomendações", value: record.recommendations.slice(0, 4).map((item, i) => `${i + 1}. ${item}`).join("\n").slice(0, 1000), inline: false });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "HostDeck Intelligence",
        avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png",
        embeds: [{
          title: record.headline || "HostDeck Intelligence",
          description: String(record.summary || "Alteração detectada.").slice(0, 3500),
          color,
          fields: fields.slice(0, 20),
          footer: { text: `HostDeck • ${record.source === "gemini" ? "Gemini" : "Monitor local"}` },
          timestamp: record.checkedAt || new Date().toISOString(),
        }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

async function performMonitorScan(force = false) {
  const prefs = getPreferences();
  if ((!prefs.aiMonitoringEnabled && !force) || monitorBusy || !serverUrl) return sendMonitorState();
  monitorBusy = true;
  sendMonitorState({ running: true });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    let response;
    try {
      response = await fetch(`${serverUrl}/api/monitor/scan`, { cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`Monitor HTTP ${response.status}`);

    const snapshot = await response.json();
    lastMonitorCheckedAt = new Date().toISOString();
    const baseEvents = detectSnapshotEvents(previousSnapshot, snapshot).map((event) => {
      if (event.type === "status_changed" && event.appId && ["offline", "paused"].includes(event.after)) {
        const { entry } = getRecoveryEntry(event.provider, event.appId);
        if (Number(entry.suppressUntil || 0) > Date.now()) {
          return { ...event, type: "manual_status_change", message: `${event.appName}: mudança para ${event.after} confirmada após uma ação manual no HostDeck.` };
        }
      }
      return event;
    });
    const events = [...baseEvents];

    if (prefs.autoRecoveryEnabled && previousSnapshot) {
      for (const event of baseEvents.filter((item) => item.type === "status_changed" && item.before === "online" && ["offline", "error"].includes(item.after))) {
        const recoveryEvent = await attemptAutoRecovery(event, snapshot, prefs);
        if (recoveryEvent) events.push(recoveryEvent);
      }
    }

    previousSnapshot = snapshot;

    if (!events.length) return sendMonitorState();

    const notable = events.some(eventIsNotable);
    const shouldNotify = notificationAllowed(events, prefs);

    // Informational changes are kept in the private timeline without popup/Discord/Gemini
    // unless the user explicitly enables informational notifications.
    if (!notable && !prefs.notifyInfoChanges) {
      const silentRecord = persistInsight({ ...fallbackInsight(events, snapshot), silent: true });
      return sendMonitorState({ lastInsight: silentRecord });
    }

    if (!shouldNotify) return sendMonitorState();

    let insight = fallbackInsight(events, snapshot);
    const recoveryAlreadyUsedGemini = events.some((event) => event.aiDecision === "gemini");

    if (!recoveryAlreadyUsedGemini && geminiSummaryAllowed(prefs)) {
      try {
        const ai = await postJson(`${serverUrl}/api/ai/analyze`, { mode: "changes", events, snapshot }, 45000);
        lastGeminiAnalyzeAt = Date.now();
        insight = { ...insight, ...ai, source: "gemini" };
      } catch (error) {
        insight = { ...insight, aiError: error instanceof Error ? error.message : "Falha ao consultar Gemini" };
      }
    }

    const record = persistInsight(insight);
    recordNotification(events);
    playAttentionSound(record.severity === "critical" ? 3 : 1);

    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("monitor:alert", record);
    sendDiscordInsight(record).catch((error) => console.error("[HostDeck Discord]", error));

    if (Notification.isSupported()) {
      const body = `${record.summary || "Alteração detectada."}${record.affectedApps?.length ? `\nApps: ${record.affectedApps.slice(0, 4).join(", ")}` : ""}`;
      const notification = new Notification({
        title: record.headline || "HostDeck Intelligence",
        body: body.slice(0, 500),
        icon: fs.existsSync(notificationIconPath()) ? notificationIconPath() : undefined,
        urgency: record.severity === "critical" ? "critical" : "normal",
      });
      notification.on("click", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send("navigation:ai-inbox", { insightId: record.id });
        }
      });
      notification.show();
    }
  } catch (error) {
    const record = persistInsight({
      severity: "warning",
      headline: "Monitoramento temporariamente indisponível",
      summary: error instanceof Error ? error.message : "Falha ao consultar a infraestrutura.",
      affectedApps: [],
      changes: [],
      recommendations: ["Verifique sua conexão e as credenciais dos provedores."],
      source: "local",
    });
    console.error("[HostDeck monitor]", error);
    sendMonitorState({ lastInsight: record });
  } finally {
    monitorBusy = false;
    sendMonitorState({ running: false });
  }
}

function startMonitorLoop(resetSnapshot = false) {
  if (monitorTimer) clearInterval(monitorTimer);
  if (resetSnapshot) previousSnapshot = null;
  const prefs = getPreferences();
  if (!prefs.aiMonitoringEnabled) {
    monitorTimer = null;
    sendMonitorState();
    return;
  }
  setTimeout(() => performMonitorScan(false).catch(() => {}), 2500);
  monitorTimer = setInterval(() => performMonitorScan(false).catch(() => {}), prefs.monitorIntervalSeconds * 1000);
  sendMonitorState();
}

function registerIpc() {
  ipcMain.handle("updates:get-status", () => updateState);
  ipcMain.handle("updates:check", async () => {
    if (!app.isPackaged) {
      sendUpdateState({ state: "unavailable", message: "No modo de desenvolvimento, atualize pelo VS Code/Git e reinicie o Electron." });
      return;
    }
    if (!updaterConfigured()) {
      sendUpdateState({
        state: "unavailable",
        message: "Este build local não possui app-update.yml. Gere/publice uma release pelo GitHub para ativar o updater.",
      });
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      sendUpdateState({ state: "error", message: friendlyUpdaterError(error) });
    }
  });
  ipcMain.handle("updates:download", async () => {
    if (!app.isPackaged || !updaterConfigured()) return;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      sendUpdateState({ state: "error", message: friendlyUpdaterError(error) });
    }
  });
  ipcMain.handle("updates:install", () => {
    if (!app.isPackaged || updateState.state !== "downloaded") return;
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  });

  ipcMain.handle("config:get-status", () => configStatus());
  ipcMain.handle("config:save", async (_event, input) => {
    const status = saveCredentials(input || {});
    applyLoginItemSetting();
    applyDiscordRpcSettings();
    startUpdateLoop();
    await restartManagedServer();
    startMonitorLoop(true);
    if (mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(serverUrl).catch(() => {});
      }, 250);
    }
    return status;
  });

  ipcMain.handle("plugins:get-status", () => configStatus());
  ipcMain.handle("plugins:save", async (_event, input) => {
    const status = savePluginConfig(input || {});
    await restartManagedServer();
    startMonitorLoop(true);
    if (mainWindow && !mainWindow.isDestroyed()) setTimeout(() => mainWindow?.loadURL(serverUrl).catch(() => {}), 250);
    return status;
  });
  ipcMain.handle("discord:activity", (_event, input) => {
    discordRpcActivity = { ...(input || {}), startedAt: Number(input?.startedAt || Date.now()) };
    const prefs = getPreferences();
    if (prefs.discordRichPresenceEnabled && prefs.discordRichPresenceClientId) connectDiscordRpc();
    sendDiscordRpcActivity();
    return { ok: true, enabled: Boolean(prefs.discordRichPresenceEnabled && prefs.discordRichPresenceClientId) };
  });
  ipcMain.handle("discord:test", async () => {
    const env = credentialsEnv();
    if (!env.DISCORD_WEBHOOK_URL) throw new Error("Configure o webhook do Discord primeiro.");
    await sendDiscordInsight({
      severity: "info",
      headline: "Integração do Discord conectada",
      summary: "Este é um teste do HostDeck. O webhook está pronto para receber alertas detalhados da sua infraestrutura.",
      affectedApps: [],
      changes: ["Canal de notificações validado com sucesso."],
      recommendations: ["Mantenha o webhook privado e não o envie ao GitHub."],
      source: "local",
      checkedAt: new Date().toISOString(),
    });
    return { ok: true };
  });

  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.handle("window:hide-to-tray", () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); });
  ipcMain.handle("app:quit", () => { isQuitting = true; app.quit(); });
  ipcMain.handle("window:is-maximized", () => Boolean(mainWindow?.isMaximized()));
  ipcMain.handle("windows:repair-shortcuts", () => repairWindowsShortcuts());

  ipcMain.handle("monitor:get-state", () => monitorState());
  ipcMain.handle("monitor:scan-now", () => performMonitorScan(true));
  ipcMain.handle("monitor:manual-action", (_event, input) => {
    recordManualAction(input || {});
    return { ok: true };
  });
  ipcMain.handle("theme:get-system", () => nativeTheme.shouldUseDarkColors ? "dark" : "light");
}

function showSplash() {
  if (START_HIDDEN) return;
  splashWindow = new BrowserWindow({
    width: 430,
    height: 280,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:transparent;font-family:Inter,Segoe UI,Arial,sans-serif;color:#f7f9ff}
    .card{height:260px;margin:10px;border:1px solid rgba(255,255,255,.15);border-radius:28px;background:linear-gradient(145deg,rgba(17,23,38,.96),rgba(7,11,21,.93));box-shadow:0 30px 90px rgba(0,0,0,.55);display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;position:relative}
    .card:before{content:"";position:absolute;width:240px;height:240px;border-radius:50%;background:#5b65ff;filter:blur(90px);opacity:.2;top:-120px;right:-70px}
    .logo{width:72px;height:72px;border-radius:22px;background:linear-gradient(145deg,#6d5dfb,#4b7eff 50%,#18c7b5);display:grid;place-items:center;box-shadow:0 18px 50px rgba(75,126,255,.28)}
    .tiers{width:38px;display:grid;gap:6px}.tiers i{height:8px;background:rgba(255,255,255,.92);border-radius:4px;display:block}
    h1{font-size:27px;letter-spacing:-.8px;margin:18px 0 4px}h1 span{color:#8fa8ff}p{margin:0;color:#7e8ba2;font-size:11px;letter-spacing:2.2px;text-transform:uppercase}
    .loader{width:150px;height:3px;border-radius:9px;background:rgba(255,255,255,.08);margin-top:28px;overflow:hidden}.loader:after{content:"";display:block;width:60%;height:100%;background:linear-gradient(90deg,#7769ff,#39b9cf);animation:load 1.2s ease-in-out infinite}@keyframes load{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}
  </style></head><body><div class="card"><div class="logo"><div class="tiers"><i></i><i></i><i></i></div></div><h1>Host<span>Deck</span></h1><p>Infrastructure Control Center</p><div class="loader"></div></div></body></html>`;
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => splashWindow?.show()).catch(() => {});
}

async function createWindow() {
  showSplash();
  serverUrl = await ensureServer();
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: "#090d16",
    title: "HostDeck",
    icon: fs.existsSync(appIconPath()) ? appIconPath() : undefined,
    frame: false,
    autoHideMenuBar: true,
    show: false,
    ...(process.platform === "win32" && !app.isPackaged ? { skipTaskbar: true } : {}),
    ...(process.platform === "win32" ? { backgroundMaterial: "acrylic" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  applyWindowsWindowIdentity(mainWindow);
  mainWindow.setTitle(APP_NAME);

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    logMessage("ERROR", "Falha ao carregar interface", { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logMessage("ERROR", "Renderer encerrado", details);
  });
  mainWindow.on("unresponsive", () => logMessage("ERROR", "Janela ficou sem resposta"));
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    try {
      const allowedOrigin = new URL(serverUrl).origin;
      if (new URL(target).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.on("maximize", () => mainWindow?.webContents.send("window:maximized", true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("window:maximized", false));
  mainWindow.on("close", (event) => {
    if (!isQuitting && app.isPackaged && getPreferences().backgroundModeEnabled) {
      event.preventDefault();
      mainWindow?.hide();
      showDesktopNotification("HostDeck continua em segundo plano", "Monitoramento e atualizações continuam ativos. Use o ícone da bandeja para abrir ou sair completamente.", revealMainWindow);
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!START_HIDDEN) mainWindow?.show();
    splashWindow?.close();
    splashWindow = null;
  });
  logMessage("INFO", "Carregando interface", serverUrl);
  await mainWindow.loadURL(serverUrl);
  logMessage("INFO", "Interface carregada");
  // ready-to-show can fire before listener in very fast dev loads; fallback.
  setTimeout(() => {
    if (!START_HIDDEN && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    splashWindow = null;
  }, 2200);

  createTray();
  startMonitorLoop(true);
  startUpdateLoop();
}

process.on("uncaughtException", (error) => {
  try { logMessage("ERROR", "uncaughtException", error); } catch {}
});
process.on("unhandledRejection", (reason) => {
  try { logMessage("ERROR", "unhandledRejection", reason); } catch {}
});

app.whenReady().then(async () => {
  ensureLogStream();
  logMessage("INFO", "HostDeck iniciando", { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, arch: process.arch, execPath: process.execPath, appId: APP_ID, appName: app.getName() });
  if (process.platform === "win32") {
    try { app.setAppUserModelId(APP_ID); } catch {}
    if (app.isPackaged) repairWindowsShortcuts();
  }
  configureUpdater();
  applyLoginItemSetting();
  applyDiscordRpcSettings();
  registerIpc();
  try {
    await createWindow();
  } catch (error) {
    splashWindow?.close();
    showStartupError(error);
    app.quit();
  }

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      revealMainWindow();
      return;
    }
    createWindow().catch((error) => {
      showStartupError(error);
      app.quit();
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && (!app.isPackaged || !getPreferences().backgroundModeEnabled)) app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  try { logMessage("INFO", "HostDeck encerrando"); } catch {}
  if (monitorTimer) clearInterval(monitorTimer);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  closeDiscordRpc();
  if (nextProcess && !nextProcess.killed) {
    try { nextProcess.kill(); } catch {}
  }
});
