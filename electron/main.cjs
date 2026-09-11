const { app, BrowserWindow, ipcMain, shell, Notification, nativeTheme, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const DEV_URL = process.env.HOSTDECK_DEV_SERVER_URL;
const FORCE_DEV_SERVER = process.env.HOSTDECK_DEV === "1";
const PREFERRED_PORT = Number(process.env.HOSTDECK_PORT || 3210);
let runtimePort = PREFERRED_PORT;
let logStream = null;
const DEFAULT_MONITOR_SECONDS = 120;
const DEFAULT_NOTIFICATION_COOLDOWN_MINUTES = 15;
const DEFAULT_GEMINI_COOLDOWN_MINUTES = 10;
const DEFAULT_RECOVERY_COOLDOWN_MINUTES = 15;
const DEFAULT_MAX_RECOVERY_ATTEMPTS_PER_HOUR = 2;
const PLUGIN_ENV_FIELDS = {
  square: { apiKey: "SQUARECLOUD_API_KEY" },
  vercel: { token: "VERCEL_TOKEN", teamId: "VERCEL_TEAM_ID" },
  render: { apiKey: "RENDER_API_KEY" },
  netlify: { token: "NETLIFY_TOKEN" },
  cloudflare: { token: "CLOUDFLARE_API_TOKEN", accountId: "CLOUDFLARE_ACCOUNT_ID" },
  digitalocean: { token: "DIGITALOCEAN_TOKEN" },
  heroku: { token: "HEROKU_API_KEY" },
};
const REQUIRED_PLUGIN_FIELDS = {
  square: ["SQUARECLOUD_API_KEY"],
  vercel: ["VERCEL_TOKEN"],
  render: ["RENDER_API_KEY"],
  netlify: ["NETLIFY_TOKEN"],
  cloudflare: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  digitalocean: ["DIGITALOCEAN_TOKEN"],
  heroku: ["HEROKU_API_KEY"],
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
};

function appIconPath() {
  return path.join(__dirname, "..", "build", "icon.png");
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
  };
}

function savePreferences(patch = {}) {
  const current = getPreferences();
  const next = { ...current };
  for (const key of ["aiMonitoringEnabled", "smartAnalysisEnabled", "autoRecoveryEnabled", "notifyInfoChanges", "discordNotificationsEnabled"]) {
    if (typeof patch[key] === "boolean") next[key] = patch[key];
  }
  if (patch.monitorIntervalSeconds != null) next.monitorIntervalSeconds = clampNumber(patch.monitorIntervalSeconds, 60, 3600, DEFAULT_MONITOR_SECONDS);
  if (patch.notificationCooldownMinutes != null) next.notificationCooldownMinutes = clampNumber(patch.notificationCooldownMinutes, 5, 120, DEFAULT_NOTIFICATION_COOLDOWN_MINUTES);
  if (patch.geminiCooldownMinutes != null) next.geminiCooldownMinutes = clampNumber(patch.geminiCooldownMinutes, 2, 120, DEFAULT_GEMINI_COOLDOWN_MINUTES);
  if (patch.recoveryCooldownMinutes != null) next.recoveryCooldownMinutes = clampNumber(patch.recoveryCooldownMinutes, 5, 180, DEFAULT_RECOVERY_COOLDOWN_MINUTES);
  if (patch.maxRecoveryAttemptsPerHour != null) next.maxRecoveryAttemptsPerHour = clampNumber(patch.maxRecoveryAttemptsPerHour, 1, 5, DEFAULT_MAX_RECOVERY_ATTEMPTS_PER_HOUR);
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
      if (!["apiKey", "token"].includes(field)) publicValues[field] = env[envName] || "";
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
    else if (!["apiKey", "token"].includes(field)) delete current[envName];
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
  });
  autoUpdater.on("update-not-available", () => sendUpdateState({ state: "up-to-date", availableVersion: undefined, percent: undefined, message: "Você já está usando a versão mais recente." }));
  autoUpdater.on("download-progress", (progress) => sendUpdateState({ state: "downloading", percent: progress.percent, message: `Baixando atualização: ${Math.round(progress.percent)}%` }));
  autoUpdater.on("update-downloaded", (info) => {
    const releaseNotes = Array.isArray(info.releaseNotes)
      ? info.releaseNotes.map((item) => typeof item === "string" ? item : item?.note || item?.version || "").filter(Boolean)
      : info.releaseNotes
        ? [String(info.releaseNotes)]
        : updateState.releaseNotes || [];
    playAttentionSound(3);
    sendUpdateState({ state: "downloaded", availableVersion: info.version, percent: 100, message: "Atualização baixada. Clique para instalar e reiniciar.", releaseNotes });
  });
  autoUpdater.on("error", (error) => sendUpdateState({ state: "error", message: error?.message || "Falha ao verificar atualização." }));

  if (app.isPackaged && !updaterConfigured()) {
    sendUpdateState({
      state: "unavailable",
      message: "Este instalador foi gerado como build local e não possui canal GitHub embutido. Publique uma release pelo GitHub Actions para habilitar atualizações automáticas.",
    });
  } else if (app.isPackaged) {
    sendUpdateState({ state: "idle", message: "Pronto para verificar atualizações no GitHub." });
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

async function sendDiscordInsight(record) {
  const env = credentialsEnv();
  const prefs = getPreferences();
  if (!prefs.discordNotificationsEnabled || !env.DISCORD_WEBHOOK_URL) return;
  const color = record.severity === "critical" ? 15548997 : record.severity === "warning" ? 16753920 : record.severity === "healthy" ? 5763719 : 5793266;
  const fields = [];
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
          fields,
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
        icon: fs.existsSync(appIconPath()) ? appIconPath() : undefined,
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
      sendUpdateState({ state: "error", message: error?.message || "Falha ao verificar atualização." });
    }
  });
  ipcMain.handle("updates:download", async () => {
    if (!app.isPackaged || !updaterConfigured()) return;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      sendUpdateState({ state: "error", message: error?.message || "Falha ao baixar atualização." });
    }
  });
  ipcMain.handle("updates:install", () => {
    if (!app.isPackaged || updateState.state !== "downloaded") return;
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  });

  ipcMain.handle("config:get-status", () => configStatus());
  ipcMain.handle("config:save", async (_event, input) => {
    const status = saveCredentials(input || {});
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
  ipcMain.handle("window:is-maximized", () => Boolean(mainWindow?.isMaximized()));

  ipcMain.handle("monitor:get-state", () => monitorState());
  ipcMain.handle("monitor:scan-now", () => performMonitorScan(true));
  ipcMain.handle("monitor:manual-action", (_event, input) => {
    recordManualAction(input || {});
    return { ok: true };
  });
  ipcMain.handle("theme:get-system", () => nativeTheme.shouldUseDarkColors ? "dark" : "light");
}

function showSplash() {
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
    ...(process.platform === "win32" ? { backgroundMaterial: "acrylic" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

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

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    splashWindow?.close();
    splashWindow = null;
  });
  logMessage("INFO", "Carregando interface", serverUrl);
  await mainWindow.loadURL(serverUrl);
  logMessage("INFO", "Interface carregada");
  // ready-to-show can fire before listener in very fast dev loads; fallback.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    splashWindow = null;
  }, 2200);

  startMonitorLoop(true);
}

process.on("uncaughtException", (error) => {
  try { logMessage("ERROR", "uncaughtException", error); } catch {}
});
process.on("unhandledRejection", (reason) => {
  try { logMessage("ERROR", "unhandledRejection", reason); } catch {}
});

app.whenReady().then(async () => {
  ensureLogStream();
  logMessage("INFO", "HostDeck iniciando", { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, arch: process.arch, execPath: process.execPath });
  if (process.platform === "win32") app.setAppUserModelId("com.hostdeck.desktop");
  configureUpdater();
  registerIpc();
  try {
    await createWindow();
  } catch (error) {
    splashWindow?.close();
    showStartupError(error);
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow().catch((error) => {
      showStartupError(error);
      app.quit();
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  try { logMessage("INFO", "HostDeck encerrando"); } catch {}
  if (monitorTimer) clearInterval(monitorTimer);
  if (nextProcess && !nextProcess.killed) {
    try { nextProcess.kill(); } catch {}
  }
});
