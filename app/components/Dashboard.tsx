"use client";

import {
  Activity, AppWindow, BellRing, Bot, Box, Check, ChevronRight, CircleAlert, CirclePause,
  CirclePlay, Cloud, Copy, Cpu, Download, ExternalLink, Globe2, HardDrive, Info, KeyRound,
  FileCode2, FolderOpen, Layers3, LayoutDashboard, Loader2, Maximize2, MemoryStick, MessageSquare, Minimize2, Monitor,
  MonitorCog, Moon, Pause, Play, Plug, RefreshCw, RotateCcw, Search, Send, Settings, ShieldCheck,
  Save, Sparkles, SquareTerminal, Sun, Trash2, Upload, Webhook, X, Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { HOSTING_PLUGINS, PLUGIN_BY_ID } from "@/lib/plugins";
import type { AppAction, HostingApp, HostingPluginDefinition, Provider } from "@/lib/types";

type ProviderInfo = { provider: Provider; configured: boolean; error?: string };
type AppsResponse = { apps: HostingApp[]; providers: ProviderInfo[]; fetchedAt: number };
type ThemeChoice = "system" | "dark" | "light";
type Page = "overview" | "apps" | "ai" | "settings";
type SettingsTab = "plugins" | "ai" | "notifications" | "appearance" | "updates";
type PendingAction = { action: AppAction; startedAt: number };
type Insight = {
  id?: string;
  severity: "healthy" | "info" | "warning" | "critical";
  headline: string;
  summary: string;
  affectedApps?: string[];
  changes?: string[];
  recommendations?: string[];
  source?: "gemini" | "local";
  model?: string | null;
  checkedAt?: string;
  aiError?: string;
  silent?: boolean;
};
type MonitorState = { enabled: boolean; intervalSeconds: number; running: boolean; lastCheckedAt?: string | null; lastInsight?: Insight | null; history?: Insight[] };
type DesktopConfigStatus = Awaited<ReturnType<NonNullable<Window["hostDeckDesktop"]>["getConfigStatus"]>>;
type UpdateState = Awaited<ReturnType<NonNullable<Window["hostDeckDesktop"]>["getUpdateStatus"]>> & { releaseNotes?: string[]; releaseVersion?: string; releaseUrl?: string; releasePublishedAt?: string };
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };

function useMediaUrl(kind: "app" | "banner") {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string }>).detail;
      if (!detail?.kind || detail.kind === kind) setRevision(Date.now());
    };
    window.addEventListener("hostdeck-media-changed", refresh);
    return () => window.removeEventListener("hostdeck-media-changed", refresh);
  }, [kind]);
  return `/api/media/${kind}?v=${revision}`;
}

const ACTION_LABEL: Record<AppAction, string> = { start: "Iniciar", stop: "Parar", restart: "Reiniciar", pause: "Pausar", resume: "Retomar" };
const BUSY_LABEL: Record<AppAction, string> = { start: "Iniciando…", stop: "Parando…", restart: "Reiniciando…", pause: "Pausando…", resume: "Retomando…" };

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function appKey(app: HostingApp) { return `${app.provider}:${app.id}`; }
function providerName(id: Provider) { return PLUGIN_BY_ID.get(id)?.name || id; }
function statusLabel(status: HostingApp["status"]) { return ({ online: "Online", offline: "Offline", paused: "Pausado", building: "Buildando", unknown: "Indefinido", error: "Erro" } as const)[status]; }
function formatDate(value?: string | number | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
function formatUptime(ms?: number) {
  if (!ms) return "—";
  const duration = ms > 10_000_000_000 ? Math.max(0, Date.now() - ms) : ms;
  const total = Math.floor(duration / 1000);
  const d = Math.floor(total / 86400); const h = Math.floor((total % 86400) / 3600); const m = Math.floor((total % 3600) / 60);
  return `${d ? `${d}d ` : ""}${h}h ${m}m`;
}
function shortDomain(url?: string) { return url?.replace(/^https?:\/\//, "").replace(/\/$/, "") || "Sem domínio"; }
function randomId(prefix = "msg") { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

const LANGUAGE_COLORS: Record<string, string> = {
  javascript: "#f1e05a",
  typescript: "#3178c6",
  python: "#3572a5",
  java: "#b07219",
  kotlin: "#a97bff",
  go: "#00add8",
  rust: "#dea584",
  php: "#4f5d95",
  ruby: "#701516",
  "c#": "#178600",
  csharp: "#178600",
  "c++": "#f34b7d",
  cpp: "#f34b7d",
  c: "#555555",
  html: "#e34c26",
  css: "#563d7c",
  shell: "#89e051",
  bash: "#89e051",
  powershell: "#012456",
  dart: "#00b4ab",
  swift: "#f05138",
  lua: "#000080",
  elixir: "#6e4a7e",
  vue: "#41b883",
  svelte: "#ff3e00",
  react: "#61dafb",
  nextjs: "#ffffff",
  next: "#ffffff",
  nodejs: "#339933",
  node: "#339933",
  deno: "#70ffaf",
  docker: "#2496ed",
  dockerfile: "#384d54",
  webdav: "#0082c9",
  workers: "#f38020",
  cloudflare: "#f38020",
};

function languageMeta(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  const aliases: Array<[RegExp, string, string]> = [
    [/typescript|\bts\b/i, "TypeScript", "typescript"],
    [/javascript|\bjs\b/i, "JavaScript", "javascript"],
    [/python/i, "Python", "python"],
    [/kotlin/i, "Kotlin", "kotlin"],
    [/\bjava\b/i, "Java", "java"],
    [/\bgolang\b|\bgo\b/i, "Go", "go"],
    [/rust/i, "Rust", "rust"],
    [/php/i, "PHP", "php"],
    [/ruby/i, "Ruby", "ruby"],
    [/c\+\+/i, "C++", "c++"],
    [/c#|csharp/i, "C#", "c#"],
    [/\bhtml\b/i, "HTML", "html"],
    [/\bcss\b/i, "CSS", "css"],
    [/powershell/i, "PowerShell", "powershell"],
    [/bash|shell/i, "Shell", "shell"],
    [/dart/i, "Dart", "dart"],
    [/swift/i, "Swift", "swift"],
    [/lua/i, "Lua", "lua"],
    [/elixir/i, "Elixir", "elixir"],
    [/vue/i, "Vue", "vue"],
    [/svelte/i, "Svelte", "svelte"],
    [/react/i, "React", "react"],
    [/next(?:\.js|js)?/i, "Next.js", "nextjs"],
    [/node(?:\.js|js)?/i, "Node.js", "nodejs"],
    [/deno/i, "Deno", "deno"],
    [/docker/i, "Docker", "docker"],
    [/webdav/i, "WebDAV", "webdav"],
    [/cloudflare workers|workers/i, "Cloudflare Workers", "workers"],
  ];
  const match = aliases.find(([pattern]) => pattern.test(raw));
  const key = match?.[2] || normalized.split(/[\s·:/()-]+/).filter(Boolean)[0] || normalized;
  const label = match?.[1] || raw;
  const fallbackHue = [...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 210);
  return { label, raw, color: LANGUAGE_COLORS[key] || `hsl(${fallbackHue} 72% 58%)` };
}

function LanguageBadge({ value }: { value?: string }) {
  const meta = languageMeta(value);
  if (!meta) return <span className="language-empty">—</span>;
  return <span className="language-badge" style={{ "--language-color": meta.color } as CSSProperties} title={meta.raw}><span />{meta.label}</span>;
}

function classifyReleaseNote(note: string) {
  const clean = note
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*+]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^>\s*/, "")
    .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
  const lower = clean.toLowerCase();
  if (!clean || /^full changelog/i.test(clean) || /^what'?s changed/i.test(clean) || /^changelog$/i.test(clean)) return null;
  if (/seguran|security|vulnerab|token|credential|🔒/.test(lower)) return { kind: "security", label: "Segurança", text: clean };
  if (/corrig|correç|fix|bug|erro|falha|🐛/.test(lower)) return { kind: "fix", label: "Correção", text: clean };
  if (/novo|adicion|plugin|provider|integraç|discloud|nextcloud|square|cloudflare|feat|✨|🚀/.test(lower)) return { kind: "new", label: "Novo", text: clean };
  if (/melhor|ajust|performance|interface|layout|chat|editor|workspace|discord|update|refactor|⚡/.test(lower)) return { kind: "improve", label: "Melhoria", text: clean };
  return { kind: "other", label: "Atualização", text: clean };
}

function BrandMark({ size = 34 }: { size?: number }) {
  return <img className="hostdeck-mark" src="/brand/hostdeck-mark.svg" alt="" width={size} height={size} />;
}

function ProviderMark({ provider, size = 18 }: { provider: Provider; size?: number }) {
  return (
    <img
      className="provider-icon-image"
      src={`/providers/${provider}.svg`}
      alt=""
      width={size}
      height={size}
      draggable={false}
    />
  );
}

function ProviderBadge({ provider }: { provider: Provider }) {
  return <span className={`provider-badge provider-${provider}`}><ProviderMark provider={provider} size={13} />{providerName(provider)}</span>;
}

function StatusPill({ status }: { status: HostingApp["status"] }) {
  return <span className={`status-pill ${status}`}><span />{statusLabel(status)}</span>;
}

function AppArtwork({ app, large = false }: { app: HostingApp; large?: boolean }) {
  const localLogo = useMediaUrl("app");
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [localLogo]);
  return (
    <div className={`app-artwork ${large ? "large" : ""}`}>
      {!failed ? <img src={localLogo} alt="" onError={() => setFailed(true)} /> : <div className="art-fallback"><AppWindow size={large ? 28 : 20} /></div>}
      <span className={`art-provider provider-${app.provider}`}><ProviderMark provider={app.provider} size={large ? 17 : 13} /></span>
    </div>
  );
}

function WindowChrome() {
  const [desktop, setDesktop] = useState<Window["hostDeckDesktop"]>();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => { setDesktop(window.hostDeckDesktop); }, []);
  useEffect(() => {
    if (!desktop) return;
    let mounted = true;
    desktop.isWindowMaximized().then((v) => mounted && setMaximized(v));
    const off = desktop.onWindowMaximized((v) => mounted && setMaximized(v));
    return () => { mounted = false; off(); };
  }, [desktop]);
  if (!desktop) return null;
  return (
    <div className="app-titlebar" onDoubleClick={() => desktop.toggleMaximizeWindow()}>
      <div className="titlebar-brand"><BrandMark size={22} /><strong>HostDeck</strong><span>Control Center</span></div>
      <div className="titlebar-status"><span /> secured local session</div>
      <div className="titlebar-drag" />
      <div className="window-controls">
        <button title="Minimizar" aria-label="Minimizar" onClick={(e) => { e.stopPropagation(); desktop.minimizeWindow(); }}><span className="chrome-minimize" /></button>
        <button title={maximized ? "Restaurar" : "Maximizar"} aria-label={maximized ? "Restaurar" : "Maximizar"} onClick={(e) => { e.stopPropagation(); desktop.toggleMaximizeWindow(); }}><span className={`chrome-maximize ${maximized ? "restore" : ""}`} /></button>
        <button className="window-close" title="Fechar" aria-label="Fechar" onClick={(e) => { e.stopPropagation(); desktop.closeWindow(); }}><X size={15} /></button>
      </div>
    </div>
  );
}

function ThemeControl({ value, onChange }: { value: ThemeChoice; onChange: (value: ThemeChoice) => void }) {
  return <div className="theme-control"><button className={value === "system" ? "active" : ""} onClick={() => onChange("system")} title="Sistema"><Monitor size={14} /></button><button className={value === "dark" ? "active" : ""} onClick={() => onChange("dark")} title="Dark"><Moon size={14} /></button><button className={value === "light" ? "active" : ""} onClick={() => onChange("light")} title="Light"><Sun size={14} /></button></div>;
}

function UpdateButton() {
  const [desktop, setDesktop] = useState<Window["hostDeckDesktop"]>();
  const [state, setState] = useState<UpdateState>({ state: "unavailable" });
  useEffect(() => { setDesktop(window.hostDeckDesktop); }, []);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    desktop.getUpdateStatus().then((value) => active && setState(value));
    const off = desktop.onUpdateStatus((value) => active && setState(value));
    return () => { active = false; off(); };
  }, [desktop]);
  if (!desktop) return null;
  const busy = state.state === "checking" || state.state === "downloading";
  const label = state.state === "available" ? `Baixar ${state.availableVersion || "update"}` : state.state === "downloaded" ? "Instalar update" : state.state === "downloading" ? `${Math.round(state.percent || 0)}%` : state.state === "checking" ? "Verificando…" : "Atualizações";
  async function act() {
    if (!desktop) return;
    if (state.state === "downloaded") await desktop.installUpdate();
    else if (state.state === "available") await desktop.downloadUpdate();
    else await desktop.checkForUpdates();
  }
  return <button className="icon-text-btn" disabled={busy} onClick={act} title={state.message}>{state.state === "downloaded" ? <Check size={15} /> : state.state === "available" ? <Download size={15} /> : <RefreshCw className={busy ? "spin" : ""} size={15} />}<span>{label}</span></button>;
}

function UpdateDetailsPanel() {
  const [desktop, setDesktop] = useState<Window["hostDeckDesktop"]>();
  const [state, setState] = useState<UpdateState>({ state: "unavailable", releaseNotes: [] });
  useEffect(() => { setDesktop(window.hostDeckDesktop); }, []);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    desktop.getUpdateStatus().then((value) => active && setState(value));
    const off = desktop.onUpdateStatus((value) => active && setState(value));
    return () => { active = false; off(); };
  }, [desktop]);
  const notes = (state.releaseNotes || [])
    .flatMap((note) => String(note).split(/\r?\n/))
    .map(classifyReleaseNote)
    .filter(Boolean)
    .slice(0, 12) as Array<{ kind: string; label: string; text: string }>;
  const shownVersion = state.availableVersion || state.releaseVersion || state.currentVersion;
  return <div className="update-release-notes">
    <div className="update-release-head">
      <div>
        <strong>{state.availableVersion ? `Versão ${state.availableVersion}` : `Versão ${shownVersion || "—"}`}</strong>
        <p>{state.message || "As mudanças da versão aparecerão aqui."}</p>
      </div>
      <span className={`update-state-pill ${state.state}`}>{state.state === "available" ? "Disponível" : state.state === "downloaded" ? "Pronta" : state.state === "downloading" ? "Baixando" : state.state === "checking" ? "Verificando" : state.state === "up-to-date" ? "Atualizado" : state.state === "error" ? "Erro" : "Local"}</span>
    </div>
    <div className="release-notes-card">
      <small>O que foi adicionado nesta versão</small>
      {notes.length ? <div className="release-note-list">{notes.map((note, index) => <div className="release-note-item" key={`${index}-${note.text.slice(0, 24)}`}><span className={`release-note-kind ${note.kind}`}>{note.label}</span><p>{note.text}</p></div>)}</div> : <p>As novidades desta versão aparecerão automaticamente aqui quando a release pública do GitHub tiver um changelog.</p>}
    </div>
  </div>;
}

function NavButton({ active, icon, label, badge, dangerBadge, onClick }: { active: boolean; icon: ReactNode; label: string; badge?: number | string; dangerBadge?: number; onClick: () => void }) {
  return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}><span className="nav-icon">{icon}</span><span>{label}</span>{dangerBadge ? <b className="nav-unread">{dangerBadge > 99 ? "99+" : dangerBadge}</b> : badge !== undefined ? <b>{badge}</b> : null}</button>;
}

function OverviewPage({ data, monitor, onOpenApps, onOpenAi, onOpenSettings }: { data: AppsResponse; monitor: MonitorState | null; onOpenApps: () => void; onOpenAi: () => void; onOpenSettings: () => void }) {
  const bannerUrl = useMediaUrl("banner");
  const online = data.apps.filter((app) => app.status === "online").length;
  const attention = data.apps.filter((app) => ["offline", "paused", "error"].includes(app.status)).length;
  const connected = data.providers.filter((provider) => provider.configured).length;
  return <div className="page-enter">
    <section className="overview-banner glass-card">
      <img className="overview-banner-media" src={bannerUrl} alt="" />
      <div className="overview-banner-shade" />
      <div className="overview-banner-content"><div className="eyebrow">Infrastructure workspace</div><h1>Controle sua infraestrutura sem perder contexto.</h1><p>Aplicações, plugins, observabilidade e Gemini em uma única central privada.</p><div className="hero-actions"><button className="btn primary" onClick={onOpenApps}><AppWindow size={16} />Ver aplicações</button><button className="btn glass" onClick={onOpenAi}><Sparkles size={16} />Abrir Intelligence</button></div></div>
      <div className="banner-health"><span className={attention ? "warn" : "ok"} /><div><strong>{attention ? `${attention} requer atenção` : "Tudo operacional"}</strong><small>{online}/{data.apps.length || 0} aplicações online</small></div></div>
    </section>
    <section className="stats-grid modern">
      <div className="stat-card glass-card"><span className="stat-icon"><AppWindow size={20} /></span><div><small>Aplicações</small><strong>{data.apps.length}</strong><p>conectadas ao HostDeck</p></div></div>
      <div className="stat-card glass-card"><span className="stat-icon ok"><CirclePlay size={20} /></span><div><small>Online agora</small><strong>{online}</strong><p>respondendo nos provedores</p></div></div>
      <div className="stat-card glass-card"><span className="stat-icon warn"><CirclePause size={20} /></span><div><small>Atenção</small><strong>{attention}</strong><p>offline, pausadas ou com erro</p></div></div>
      <div className="stat-card glass-card"><span className="stat-icon"><Plug size={20} /></span><div><small>Plugins</small><strong>{connected}/{HOSTING_PLUGINS.length}</strong><p>hospedagens conectadas</p></div></div>
    </section>
    <div className="overview-grid">
      <section className="glass-card overview-section"><header><div><div className="eyebrow">Conexões</div><h2>Hospedagens</h2></div><button className="text-button" onClick={onOpenSettings}>Gerenciar plugins <ChevronRight size={14} /></button></header><div className="provider-health-grid">{HOSTING_PLUGINS.map((plugin) => { const info = data.providers.find((p) => p.provider === plugin.id); const count = data.apps.filter((app) => app.provider === plugin.id).length; return <div className={`provider-health-card ${info?.configured ? "connected" : ""}`} key={plugin.id}><span className={`provider-logo provider-${plugin.id}`}><ProviderMark provider={plugin.id} /></span><div><strong>{plugin.shortName}</strong><small>{info?.error ? "Erro de conexão" : info?.configured ? `${count} vinculada${count === 1 ? "" : "s"}` : "Não conectado"}</small></div><span className={`health-dot ${info?.error ? "error" : info?.configured ? "ok" : "off"}`} /></div>; })}</div></section>
      <section className="glass-card overview-section intelligence-preview"><header><div><div className="eyebrow">AI monitoring</div><h2>Intelligence Inbox</h2></div><button className="text-button" onClick={onOpenAi}>Abrir chat <ChevronRight size={14} /></button></header>{monitor?.lastInsight ? <div className={`insight-preview ${monitor.lastInsight.severity}`}><span className="insight-orb"><Sparkles size={18} /></span><div><strong>{monitor.lastInsight.headline}</strong><p>{monitor.lastInsight.summary}</p><small>{formatDate(monitor.lastInsight.checkedAt)} · {monitor.lastInsight.source === "gemini" ? "Gemini" : "Monitor local"}</small></div></div> : <div className="empty-inline"><Bot size={26} /><div><strong>Monitor pronto</strong><p>O primeiro evento de infraestrutura vai aparecer aqui e no chat privado.</p></div></div>}</section>
    </div>
  </div>;
}

function CompactAppCard({ app, selected, onClick }: { app: HostingApp; selected: boolean; onClick: () => void }) {
  return <article role="button" tabIndex={0} className={`compact-app-card glass-card ${selected ? "selected" : ""}`} onClick={onClick} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } }}>
    <div className="compact-card-top"><AppArtwork app={app} /><StatusPill status={app.status} /></div>
    <div className="compact-card-body"><ProviderBadge provider={app.provider} /><h3>{app.name}</h3><p>{app.description || `Aplicação vinculada pela integração ${providerName(app.provider)}.`}</p></div>
    <div className="compact-card-footer"><span className="compact-domain">{shortDomain(app.url)}</span><div className="compact-meta">{app.language && <LanguageBadge value={app.language} />}<ChevronRight size={15} /></div></div>
  </article>;
}

function ActionButtons({ app, pending, onAction }: { app: HostingApp; pending?: PendingAction; onAction: (app: HostingApp, action: AppAction) => void }) {
  if (!app.actions.length) return null;
  return <div className="action-group">{app.actions.map((action) => <button key={action} className={`btn action action-${action}`} disabled={Boolean(pending)} onClick={() => onAction(app, action)}>{pending?.action === action ? <Loader2 className="spin" size={14} /> : action === "restart" ? <RotateCcw size={14} /> : ["start", "resume"].includes(action) ? <Play size={14} /> : <Pause size={14} />}{pending?.action === action ? BUSY_LABEL[action] : ACTION_LABEL[action]}</button>)}</div>;
}

function AppExpanded({ app, pending, onAction, onLogs, onWorkspace, onToast }: { app: HostingApp; pending?: PendingAction; onAction: (app: HostingApp, action: AppAction) => void; onLogs: () => void; onWorkspace: () => void; onToast: (m: string) => void }) {
  const bannerUrl = useMediaUrl("banner");
  const [details, setDetails] = useState<Partial<HostingApp>>({});
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    const refresh = async (initial = false) => {
      if (initial) { setDetails({}); setLoading(true); }
      try {
        const r = await fetch(`/api/apps/${app.provider}/${encodeURIComponent(app.id)}/details`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Falha");
        if (active) setDetails(j.details || {});
      } catch {
        // Mantém o último snapshot visível quando um refresh isolado falhar.
      } finally {
        if (active && initial) setLoading(false);
      }
    };
    refresh(true);
    timer = window.setInterval(() => refresh(false), 5000);
    return () => { active = false; if (timer) window.clearInterval(timer); };
  }, [app.provider, app.id]);
  const view: HostingApp = { ...app, ...details, actions: details.actions ?? app.actions };
  async function copy(value?: string) { if (!value) return; try { await navigator.clipboard.writeText(value); onToast("Copiado para a área de transferência."); } catch { onToast("Não foi possível copiar."); } }
  return <section key={appKey(app)} className="app-expanded glass-card detail-enter">
    <div className="app-expanded-banner"><img src={bannerUrl} alt="" /><div className="expanded-banner-overlay" /><div className="expanded-head"><AppArtwork app={view} large /><div className="expanded-identity"><ProviderBadge provider={view.provider} /><h2>{view.name}</h2><p>{view.description || `Aplicação gerenciada pelo plugin ${providerName(view.provider)}.`}</p></div><StatusPill status={view.status} /></div></div>
    {pending && <div className="operation-banner"><Loader2 className="spin" size={16} /><div><strong>{BUSY_LABEL[pending.action]}</strong><span>Os controles serão liberados depois que o provedor confirmar o estado.</span></div></div>}
    <div className="expanded-toolbar"><div className="action-group"><button className="btn glass" onClick={onLogs}><SquareTerminal size={15} />Logs</button>{Boolean(view.metadata?.workspace) && <button className="btn glass workspace-launch" onClick={onWorkspace}><FileCode2 size={15} />Workspace</button>}{view.url && <a className="btn glass" href={view.url} target="_blank" rel="noreferrer"><ExternalLink size={15} />Abrir</a>}</div><ActionButtons app={view} pending={pending} onAction={onAction} /></div>
    <div className="expanded-grid"><div className="metric-tile"><span>Status</span><strong>{statusLabel(view.status)}</strong><small>{providerName(view.provider)}</small></div><div className="metric-tile"><span>CPU</span><strong>{view.cpu || "—"}</strong><small>uso atual</small></div><div className="metric-tile"><span>Memória</span><strong>{view.ram || "—"}</strong><small>uso atual</small></div><div className="metric-tile"><span>Uptime</span><strong>{formatUptime(view.uptime)}</strong><small>{loading ? "consultando…" : "tempo online"}</small></div></div>
    <div className="expanded-sections"><section><header><Globe2 size={15} />Endereço</header>{view.url ? <div className="property-row"><span className="truncate">{view.url}</span><button onClick={() => copy(view.url)}><Copy size={13} /></button></div> : <div className="empty-property">Nenhum domínio público informado.</div>}<div className="property-row"><span>Provider</span><strong>{providerName(view.provider)}</strong></div><div className="property-row"><span>Região/cluster</span><strong>{view.region || view.cluster || "—"}</strong></div></section><section><header><MonitorCog size={15} />Deploy & runtime</header><div className="property-row"><span>Stack</span><LanguageBadge value={view.language} /></div><div className="property-row"><span>Deployment</span><strong>{view.latestDeploymentState || "—"}</strong></div><div className="property-row"><span>Atualizado</span><strong>{formatDate(view.updatedAt)}</strong></div></section><section><header><Info size={15} />Identificação</header><div className="property-row"><span className="truncate">{view.id}</span><button onClick={() => copy(view.id)}><Copy size={13} /></button></div><div className="property-row"><span>Storage</span><strong>{view.storage || "—"}</strong></div><div className="property-row"><span>Rede</span><strong>{view.network || "—"}</strong></div></section></div>
  </section>;
}

function AppDetailsModal({ app, pending, onAction, onLogs, onWorkspace, onToast, onClose }: { app: HostingApp; pending?: PendingAction; onAction: (app: HostingApp, action: AppAction) => void; onLogs: () => void; onWorkspace: () => void; onToast: (m: string) => void; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="modal-backdrop app-details-backdrop" onMouseDown={onClose} role="presentation">
      <div className="app-details-modal" role="dialog" aria-modal="true" aria-label={`Detalhes de ${app.name}`} onMouseDown={(event) => event.stopPropagation()}>
        <button className="app-modal-close" onClick={onClose} title="Fechar detalhes" aria-label="Fechar detalhes"><X size={18} /></button>
        <div className="app-details-scroll">
          <AppExpanded app={app} pending={pending} onAction={onAction} onLogs={onLogs} onWorkspace={onWorkspace} onToast={onToast} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ApplicationsPage({ data, loading, pending, provider, onProviderChange, onAction, onLogs, onWorkspace, onSelectionChange, onRefresh, onToast }: { data: AppsResponse; loading: boolean; pending: Record<string, PendingAction>; provider: "all" | Provider; onProviderChange: (provider: "all" | Provider) => void; onAction: (app: HostingApp, action: AppAction) => void; onLogs: (app: HostingApp) => void; onWorkspace: (app: HostingApp) => void; onSelectionChange: (app: HostingApp | null) => void; onRefresh: () => void; onToast: (m: string) => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const filtered = useMemo(
    () => data.apps.filter((app) => (provider === "all" || app.provider === provider) && (!query.trim() || `${app.name} ${app.url || ""} ${providerName(app.provider)} ${app.description || ""}`.toLowerCase().includes(query.toLowerCase()))),
    [data.apps, provider, query],
  );
  const selectedApp = data.apps.find((app) => appKey(app) === selected);
  useEffect(() => {
    if (selected && !filtered.some((app) => appKey(app) === selected)) { setSelected(""); onSelectionChange(null); }
  }, [filtered, selected]);
  const connectedProviders = data.providers.filter((item) => item.configured);

  return <div className="page-enter applications-page">
    <header className="page-header">
      <div><div className="eyebrow">Applications</div><h1>Aplicações vinculadas</h1><p>Veja tudo em cards compactos. Clique em qualquer card para abrir os detalhes em uma janela central.</p></div>
      <button className="icon-text-btn primary-soft" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} />Atualizar</button>
    </header>
    <div className="apps-toolbar">
      <label className="search-box glass-card"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar aplicação, domínio ou provedor…" /></label>
      <div className="provider-filter glass-card"><button className={provider === "all" ? "active" : ""} onClick={() => { setSelected(""); onSelectionChange(null); onProviderChange("all"); }}>Todas</button>{connectedProviders.map((item) => <button key={item.provider} className={provider === item.provider ? "active" : ""} onClick={() => { setSelected(""); onSelectionChange(null); onProviderChange(item.provider); }}><ProviderMark provider={item.provider} size={16} />{PLUGIN_BY_ID.get(item.provider)?.shortName}</button>)}</div>
    </div>
    {loading && !data.apps.length ? (
      <div className="apps-card-grid">{Array.from({ length: 6 }).map((_, i) => <div className="compact-app-card glass-card skeleton" key={i} />)}</div>
    ) : filtered.length ? (
      <div className="apps-card-grid">{filtered.map((app) => <CompactAppCard key={appKey(app)} app={app} selected={selected === appKey(app)} onClick={() => { setSelected(appKey(app)); onSelectionChange(app); }} />)}</div>
    ) : (
      <div className="empty-state glass-card"><AppWindow size={34} /><h3>Nenhuma aplicação encontrada</h3><p>Conecte um plugin de hospedagem ou altere os filtros.</p></div>
    )}
    {selectedApp && <AppDetailsModal app={selectedApp} pending={pending[appKey(selectedApp)]} onAction={onAction} onLogs={() => onLogs(selectedApp)} onWorkspace={() => onWorkspace(selectedApp)} onToast={onToast} onClose={() => { setSelected(""); onSelectionChange(null); }} />}
  </div>;
}

function InsightCard({ insight }: { insight: Insight }) {
  return <article className={`timeline-insight ${insight.severity}`}><span className="timeline-icon">{insight.severity === "critical" ? <CircleAlert size={16} /> : <Sparkles size={16} />}</span><div><div className="timeline-meta"><strong>{insight.headline}</strong><time>{formatDate(insight.checkedAt)}</time></div><p>{insight.summary}</p>{Boolean(insight.affectedApps?.length) && <div className="tag-row">{insight.affectedApps!.map((name) => <span key={name}>{name}</span>)}</div>}{Boolean(insight.recommendations?.length) && <details><summary>Recomendações</summary><ol>{insight.recommendations!.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ol></details>}</div></article>;
}

function AiInboxPage({ data, monitor, onMonitorChange, config, onOpenSettings }: { data: AppsResponse; monitor: MonitorState | null; onMonitorChange: (state: MonitorState) => void; config: DesktopConfigStatus | null; onOpenSettings: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [scope, setScope] = useState("all");
  const feedRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => { try { const raw = localStorage.getItem("hostdeck-ai-chat"); if (raw) setMessages(JSON.parse(raw)); } catch {} }, []);
  useEffect(() => { if (messages.length) localStorage.setItem("hostdeck-ai-chat", JSON.stringify(messages.slice(-80))); }, [messages]);
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const node = feedRef.current;
    if (!node) return;
    requestAnimationFrame(() => { node.scrollTop = node.scrollHeight; });
  }, [messages, monitor?.history?.length, sending]);

  const scopedApps = useMemo(() => {
    if (scope === "all") return data.apps;
    if (scope.startsWith("provider:")) return data.apps.filter((app) => app.provider === scope.slice("provider:".length));
    if (scope.startsWith("app:")) {
      const key = scope.slice("app:".length);
      return data.apps.filter((app) => appKey(app) === key);
    }
    return data.apps;
  }, [data.apps, scope]);
  const scopedProviders = useMemo(() => {
    const ids = new Set(scopedApps.map((app) => app.provider));
    return data.providers.filter((provider) => scope === "all" || ids.has(provider.provider));
  }, [data.providers, scopedApps, scope]);
  const scopeLabel = scope === "all"
    ? "Toda a infraestrutura"
    : scope.startsWith("provider:")
      ? providerName(scope.slice("provider:".length) as Provider)
      : scopedApps[0]?.name || "Aplicação";

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    const user: ChatMessage = { id: randomId("u"), role: "user", content, createdAt: new Date().toISOString() };
    const assistantId = randomId("a");
    const assistant: ChatMessage = { id: assistantId, role: "assistant", content: "", createdAt: new Date().toISOString() };
    const history = [...messages, user];
    setMessages([...history, assistant]);
    setInput("");
    setSending(true);
    setError("");
    stickToBottomRef.current = true;
    try {
      const response = await fetch("/api/ai/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content: value }) => ({ role, content: value })),
          snapshot: { apps: scopedApps, providers: scopedProviders },
          alerts: monitor?.history || [],
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error || "Falha no Gemini");
      }
      if (!response.body) throw new Error("O Gemini não iniciou a resposta.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let received = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          for (const line of block.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            try {
              const event = JSON.parse(line.slice(5).trim());
              if (event.type === "delta" && typeof event.text === "string") {
                received += event.text;
                setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: received } : message));
              } else if (event.type === "error") {
                throw new Error(event.error || "Falha no stream do Gemini");
              }
            } catch (streamError) {
              if (streamError instanceof SyntaxError) continue;
              throw streamError;
            }
          }
        }
      }
      if (!received.trim()) throw new Error("O Gemini terminou sem retornar texto.");
    } catch (e) {
      setMessages((current) => current.filter((message) => message.id !== assistantId || message.content.trim()));
      setError(e instanceof Error ? e.message : "Falha ao conversar com o Gemini.");
    } finally {
      setSending(false);
    }
  }

  async function scanNow() {
    if (window.hostDeckDesktop) { const state = await window.hostDeckDesktop.scanNow(); if (state) onMonitorChange(state); }
  }
  const alerts = monitor?.history || [];
  const connectedProviders = data.providers.filter((provider) => provider.configured);

  return <div className="page-enter ai-page">
    <header className="page-header ai-page-head">
      <div><div className="eyebrow">Private AI workspace</div><h1>Intelligence Inbox</h1><p>O painel fica parado. Só a lista de mensagens rola, enquanto o Gemini escreve a resposta em tempo real.</p></div>
      <div className="ai-head-actions"><span className={`monitor-state ${monitor?.enabled ? "on" : "off"}`}><span />{monitor?.enabled ? `Monitorando a cada ${Math.round((monitor.intervalSeconds || 120) / 60)} min${config?.autoRecoveryEnabled ? " · Auto Recovery" : ""}` : "Monitor pausado"}</span><button className="btn glass" onClick={scanNow} disabled={monitor?.running}>{monitor?.running ? <Loader2 className="spin" size={14} /> : <Activity size={14} />}Escanear agora</button></div>
    </header>
    <div className="ai-layout">
      <aside className="ai-thread-list glass-card">
        <div className="ai-thread-title"><Sparkles size={17} /><div><strong>Contexto do chat</strong><small>{scopeLabel}</small></div></div>
        <button className={`thread ${scope === "all" ? "active" : ""}`} onClick={() => setScope("all")}><span className="thread-avatar"><AppWindow size={17} /></span><div><strong>Todas as aplicações</strong><small>{data.apps.length} apps no contexto</small></div></button>
        <div className="thread-section-title">Hospedagens</div>
        {connectedProviders.map((item) => <button className={`thread ${scope === `provider:${item.provider}` ? "active" : ""}`} key={item.provider} onClick={() => setScope(`provider:${item.provider}`)}><span className={`thread-avatar provider-${item.provider}`}><ProviderMark provider={item.provider} size={17} /></span><div><strong>{PLUGIN_BY_ID.get(item.provider)?.shortName}</strong><small>{data.apps.filter((app) => app.provider === item.provider).length} apps</small></div></button>)}
        <div className="thread-section-title">Aplicações</div>
        <div className="ai-app-scope-list">{data.apps.slice(0, 24).map((app) => <button className={`quick-thread scope-app ${scope === `app:${appKey(app)}` ? "active" : ""}`} key={appKey(app)} onClick={() => setScope(`app:${appKey(app)}`)}><span><ProviderMark provider={app.provider} size={13} />{app.name}</span><ChevronRight size={13} /></button>)}</div>
        <div className="ai-config-mini"><KeyRound size={14} /><div><strong>{config?.geminiConfigured ? "Gemini conectado" : "Gemini não configurado"}</strong><small>{config?.geminiConfigured ? config.geminiModel : "Adicione sua API key"}</small></div><button onClick={onOpenSettings}><Settings size={13} /></button></div>
      </aside>

      <section className="ai-chat glass-card">
        <header className="chat-header"><div><span className="ai-orb"><Sparkles size={18} /></span><div><strong>{scopeLabel}</strong><small>Contexto: {scopedApps.length} apps · {scopedProviders.filter((p) => p.configured).length} plugins</small></div></div><span className="private-pill"><ShieldCheck size={12} />stream privado</span></header>
        <div className="chat-feed" ref={feedRef} onScroll={(event) => { const node = event.currentTarget; stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }}>
          <div className="chat-welcome"><Sparkles size={24} /><h2>Como posso ajudar com sua infraestrutura?</h2><p>Você pode continuar digitando enquanto a resposta chega. O restante da tela não se move.</p></div>
          {alerts.slice(0, 10).reverse().map((insight) => <InsightCard key={insight.id || insight.checkedAt || insight.headline} insight={insight} />)}
          {messages.map((message) => <div key={message.id} className={`chat-message ${message.role}`}><div className="chat-message-avatar">{message.role === "assistant" ? <Sparkles size={15} /> : "Você"}</div><div><p>{message.content || (sending && message.role === "assistant" ? " " : "")}</p><time>{formatDate(message.createdAt)}</time></div></div>)}
          {sending && <div className="chat-stream-state"><span className="stream-dot" /><span>Gemini escrevendo…</span></div>}
          {error && <div className="chat-error">{error}</div>}
        </div>
        <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <div className="chat-input-shell"><textarea value={input} onChange={(e) => { setInput(e.target.value); e.currentTarget.style.height = "auto"; e.currentTarget.style.height = `${Math.min(150, Math.max(52, e.currentTarget.scrollHeight))}px`; }} placeholder={config?.geminiConfigured ? `Pergunte sobre ${scopeLabel.toLowerCase()}…` : "Configure o Gemini nas configurações para conversar…"} disabled={!config?.geminiConfigured} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} /><div className="composer-hint"><span>Enter envia · Shift+Enter quebra linha</span>{sending && <span className="composer-live"><span />RESPOSTA AO VIVO</span>}</div></div>
          <button type="submit" disabled={!config?.geminiConfigured || !input.trim() || sending} title={sending ? "Aguarde a resposta atual" : "Enviar"}><Send size={16} /></button>
        </form>
      </section>
    </div>
  </div>;
}

function BookOpenTextFallback() { return <span className="inline-icon-fallback">📘</span>; }

function PluginSetupModal({ plugin, status, onClose, onSaved }: { plugin: HostingPluginDefinition; status: DesktopConfigStatus | null; onClose: () => void; onSaved: (status: DesktopConfigStatus) => void }) {
  const [values, setValues] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [desktop, setDesktop] = useState<Window["hostDeckDesktop"]>();
  useEffect(() => { setDesktop(window.hostDeckDesktop); }, []);
  useEffect(() => { const publicValues = status?.plugins?.[plugin.id]?.values || {}; setValues(publicValues); }, [plugin.id, status]);
  async function save() {
    if (!desktop) return; setSaving(true); setError("");
    try { const next = await desktop.savePlugin({ id: plugin.id, values }); onSaved(next); } catch (e) { setError(e instanceof Error ? e.message : "Falha ao salvar plugin"); } finally { setSaving(false); }
  }
  async function remove() {
    if (!desktop) return; setSaving(true); setError("");
    try { const next = await desktop.savePlugin({ id: plugin.id, remove: true }); onSaved(next); } catch (e) { setError(e instanceof Error ? e.message : "Falha ao remover plugin"); } finally { setSaving(false); }
  }
  const configured = Boolean(status?.plugins?.[plugin.id]?.configured);
  return <div className="modal-backdrop" onMouseDown={saving ? undefined : onClose}><section className="plugin-modal glass-modal" onMouseDown={(e) => e.stopPropagation()}><header><div className={`plugin-hero-icon provider-${plugin.id}`}><ProviderMark provider={plugin.id} size={21} /></div><div><div className="eyebrow">Hosting plugin</div><h2>{plugin.name}</h2><p>{plugin.description}</p></div><button className="close-btn" onClick={onClose}><X size={17} /></button></header><div className="plugin-modal-body"><div className="capability-row">{plugin.capabilities.map((item) => <span key={item}>{item}</span>)}</div>{!desktop && <div className="settings-note">No modo navegador, configure as variáveis no <code>.env.local</code>. O gerenciador seguro de plugins funciona no app Electron.</div>}<div className="plugin-help-grid"><div className="plugin-help-card"><strong>Onde pegar a chave</strong><ol>{(plugin.tokenGuide || []).map((step) => <li key={step}>{step}</li>)}</ol></div><div className="plugin-help-card"><strong>Links úteis</strong><div className="plugin-help-links">{plugin.portalUrl && <a className="btn glass mini" href={plugin.portalUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />Abrir painel</a>}<a className="btn glass mini" href={plugin.docsUrl} target="_blank" rel="noreferrer"><BookOpenTextFallback />Documentação</a></div><p>Depois de salvar, o HostDeck mostra que a integração foi concluída e passa a listar as aplicações desse provedor.</p></div></div>{plugin.fields.map((field) => <label className="settings-field" key={field.key}><span>{field.label}{field.optional && <small> opcional</small>}</span><input type={field.secret ? "password" : "text"} autoComplete="off" value={values[field.key] || ""} onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))} placeholder={configured && field.secret ? "•••••••• credencial salva ••••••••" : field.placeholder} />{field.help && <small>{field.help}</small>}</label>)}{error && <div className="settings-error">{error}</div>}</div><footer>{configured && desktop && <button className="btn danger-ghost" onClick={remove} disabled={saving}><Trash2 size={14} />Desconectar</button>}<div className="spacer" /><button className="btn glass" onClick={onClose}>Cancelar</button>{desktop && <button className="btn primary" onClick={save} disabled={saving}>{saving ? <Loader2 className="spin" size={14} /> : <Check size={14} />}{configured ? "Salvar alterações" : "Conectar plugin"}</button>}</footer></section></div>;
}

function MediaUploadCard({ kind, title, description }: { kind: "app" | "banner"; title: string; description: string }) {
  const mediaUrl = useMediaUrl(kind);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/media/${kind}`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao enviar imagem.");
      window.dispatchEvent(new CustomEvent("hostdeck-media-changed", { detail: { kind } }));
      setMessage("Imagem salva localmente no HostDeck.");
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao enviar imagem.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/media/${kind}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao remover imagem.");
      window.dispatchEvent(new CustomEvent("hostdeck-media-changed", { detail: { kind } }));
      setMessage("Imagem personalizada removida. O padrão local foi restaurado.");
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao remover imagem.");
    } finally {
      setBusy(false);
    }
  }

  return <article className={`media-upload-card ${kind}`}>
    <div className="media-upload-preview"><img src={mediaUrl} alt={`Prévia: ${title}`} /></div>
    <div className="media-upload-content"><strong>{title}</strong><p>{description}</p><small>PNG, JPG, WebP, GIF ou AVIF · máximo 25 MB</small></div>
    <div className="media-upload-actions">
      <label className={`btn primary media-file-button ${busy ? "disabled" : ""}`}><Upload size={15} />{busy ? "Salvando…" : "Escolher arquivo"}<input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" disabled={busy} onChange={(event) => upload(event.target.files?.[0])} /></label>
      <button className="btn glass" onClick={remove} disabled={busy}><Trash2 size={14} />Restaurar padrão</button>
    </div>
    {message && <div className="media-upload-message">{message}</div>}
  </article>;
}

function SettingsPage({ theme, onThemeChange, config, setConfig, data, initialTab = "plugins" }: { theme: ThemeChoice; onThemeChange: (v: ThemeChoice) => void; config: DesktopConfigStatus | null; setConfig: (v: DesktopConfigStatus) => void; data: AppsResponse; initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [selectedPlugin, setSelectedPlugin] = useState<HostingPluginDefinition | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-3.8-flash");
  const [monitoring, setMonitoring] = useState(true);
  const [smartAnalysis, setSmartAnalysis] = useState(true);
  const [autoRecovery, setAutoRecovery] = useState(false);
  const [notifyInfoChanges, setNotifyInfoChanges] = useState(false);
  const [interval, setIntervalValue] = useState(120);
  const [notificationCooldown, setNotificationCooldown] = useState(15);
  const [geminiCooldown, setGeminiCooldown] = useState(10);
  const [recoveryCooldown, setRecoveryCooldown] = useState(15);
  const [maxRecoveryAttempts, setMaxRecoveryAttempts] = useState(2);
  const [discordUrl, setDiscordUrl] = useState("");
  const [discordEnabled, setDiscordEnabled] = useState(true);
  const [discordStatusGraph, setDiscordStatusGraph] = useState(true);
  const [discordRpcEnabled, setDiscordRpcEnabled] = useState(false);
  const [discordRpcClientId, setDiscordRpcClientId] = useState("");
  const [automaticUpdates, setAutomaticUpdates] = useState(true);
  const [automaticDownload, setAutomaticDownload] = useState(true);
  const [updateCheckMinutes, setUpdateCheckMinutes] = useState(30);
  const [backgroundMode, setBackgroundMode] = useState(true);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [desktop, setDesktop] = useState<Window["hostDeckDesktop"]>();

  useEffect(() => { setDesktop(window.hostDeckDesktop); }, []);
  useEffect(() => {
    if (!config) return;
    setGeminiModel(config.geminiModel || "gemini-3.8-flash");
    setMonitoring(config.aiMonitoringEnabled);
    setSmartAnalysis(config.smartAnalysisEnabled !== false);
    setAutoRecovery(Boolean(config.autoRecoveryEnabled));
    setNotifyInfoChanges(Boolean(config.notifyInfoChanges));
    setIntervalValue(config.monitorIntervalSeconds);
    setNotificationCooldown(config.notificationCooldownMinutes || 15);
    setGeminiCooldown(config.geminiCooldownMinutes || 10);
    setRecoveryCooldown(config.recoveryCooldownMinutes || 15);
    setMaxRecoveryAttempts(config.maxRecoveryAttemptsPerHour || 2);
    setDiscordEnabled(config.discordNotificationsEnabled !== false);
    setDiscordStatusGraph(config.discordStatusGraphEnabled !== false);
    setDiscordRpcEnabled(Boolean(config.discordRichPresenceEnabled));
    setDiscordRpcClientId(config.discordRichPresenceClientId || "");
    setAutomaticUpdates(config.automaticUpdatesEnabled !== false);
    setAutomaticDownload(config.automaticUpdateDownload !== false);
    setUpdateCheckMinutes(config.updateCheckMinutes || 30);
    setBackgroundMode(config.backgroundModeEnabled !== false);
    setLaunchAtLogin(Boolean(config.launchAtLogin));
  }, [config]);

  async function saveIntelligence() {
    if (!desktop) return;
    setSaving(true);
    setMessage("");
    try {
      const next = await desktop.saveConfig({
        geminiKey,
        geminiModel,
        aiMonitoringEnabled: monitoring,
        smartAnalysisEnabled: smartAnalysis,
        autoRecoveryEnabled: autoRecovery,
        notifyInfoChanges,
        monitorIntervalSeconds: interval,
        notificationCooldownMinutes: notificationCooldown,
        geminiCooldownMinutes: geminiCooldown,
        recoveryCooldownMinutes: recoveryCooldown,
        maxRecoveryAttemptsPerHour: maxRecoveryAttempts,
      });
      setConfig(next);
      setGeminiKey("");
      setMessage("Configurações da inteligência salvas.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function saveDiscord() {
    if (!desktop) return;
    setSaving(true);
    setMessage("");
    try {
      const next = await desktop.saveConfig({ discordWebhookUrl: discordUrl, discordNotificationsEnabled: discordEnabled, discordStatusGraphEnabled: discordStatusGraph, discordRichPresenceEnabled: discordRpcEnabled, discordRichPresenceClientId: discordRpcClientId });
      setConfig(next);
      setDiscordUrl("");
      setMessage("Configuração do Discord salva.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function testDiscord() {
    if (!desktop) return;
    setSaving(true);
    setMessage("");
    try {
      await desktop.testDiscord();
      setMessage("Mensagem de teste enviada para o Discord.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha no teste");
    } finally {
      setSaving(false);
    }
  }

  async function saveUpdates() {
    if (!desktop) return;
    setSaving(true);
    setMessage("");
    try {
      const next = await desktop.saveConfig({
        automaticUpdatesEnabled: automaticUpdates,
        automaticUpdateDownload: automaticDownload,
        updateCheckMinutes,
        backgroundModeEnabled: backgroundMode,
        launchAtLogin,
      });
      setConfig(next);
      setMessage("Preferências de atualização salvas. O HostDeck já aplicou o novo comportamento.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha ao salvar atualização");
    } finally {
      setSaving(false);
    }
  }

  async function repairWindowsShortcuts() {
    if (!desktop?.repairWindowsShortcuts) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await desktop.repairWindowsShortcuts();
      setMessage(result.ok ? "Atalhos do HostDeck reparados. Abra o HostDeck pelo Menu Iniciar e fixe esse ícone na barra de tarefas." : "Os atalhos foram verificados, mas algum item não pôde ser recriado. Consulte o log do HostDeck.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha ao reparar atalhos do Windows.");
    } finally {
      setSaving(false);
    }
  }

  const connected = HOSTING_PLUGINS.filter((plugin) => config?.plugins?.[plugin.id]?.configured || data.providers.find((p) => p.provider === plugin.id)?.configured).length;
  const tabs: [SettingsTab, string, ReactNode][] = [
    ["plugins", "Plugins", <Plug size={18} />],
    ["ai", "Inteligência IA", <Sparkles size={18} />],
    ["notifications", "Notificações", <BellRing size={18} />],
    ["appearance", "Aparência", <Sun size={18} />],
    ["updates", "Atualizações", <Download size={18} />],
  ];

  return <div className="page-enter settings-page">
    <header className="page-header"><div><div className="eyebrow">Control plane</div><h1>Configurações</h1><p>Plugins, inteligência, notificações, aparência e atualizações em um painel mais organizado.</p></div></header>
    <div className="settings-shell">
      <aside className="settings-nav glass-card">
        {tabs.map(([id, label, icon]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setMessage(""); }}>{icon}<span>{label}</span>{id === "plugins" && <b>{connected}</b>}</button>)}
      </aside>

      <section className="settings-content glass-card">
        <div key={tab} className="settings-tab-enter">
          {tab === "plugins" && <>
            <div className="settings-section-head"><div><div className="eyebrow">Plugin hub</div><h2>Hospedagens</h2><p>Clique em qualquer integração para conectar ou editar as credenciais. Os ícones ficam visíveis em todo o HostDeck.</p></div><span className="settings-count">{connected}/{HOSTING_PLUGINS.length} conectados</span></div>
            <div className="plugin-grid">
              {HOSTING_PLUGINS.map((plugin) => {
                const pluginState = config?.plugins?.[plugin.id];
                const info = data.providers.find((p) => p.provider === plugin.id);
                const isConnected = pluginState?.configured || info?.configured;
                const appCount = data.apps.filter((app) => app.provider === plugin.id).length;
                return <article role="button" tabIndex={0} className={`plugin-card ${isConnected ? "connected" : ""}`} key={plugin.id} onClick={() => setSelectedPlugin(plugin)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedPlugin(plugin); } }}>
                  <div className="plugin-card-head"><span className={`plugin-logo provider-${plugin.id}`}><ProviderMark provider={plugin.id} size={30} /></span><span className={`plugin-state ${info?.error ? "error" : isConnected ? "on" : "off"}`}>{info?.error ? "Erro" : isConnected ? "Conectado" : "Disponível"}</span></div>
                  <h3>{plugin.name}</h3>
                  <p>{plugin.description}</p>
                  <div className="plugin-capabilities">{plugin.capabilities.slice(0, 3).map((cap) => <span key={cap}>{cap}</span>)}</div>
                  <footer><span>{isConnected ? `${appCount} ${appCount === 1 ? "app" : "apps"}` : "API integration"}</span><span className="plugin-card-cta">{isConnected ? "Configurar" : "Adicionar"}<ChevronRight size={16} /></span></footer>
                </article>;
              })}
            </div>
            <div className="plugin-sdk-note"><Plug size={20} /><div><strong>Arquitetura extensível</strong><p>Os conectores ficam separados por provedor, permitindo adicionar novas hospedagens sem refazer o dashboard.</p></div></div>
          </>}

          {tab === "ai" && <>
            <div className="settings-section-head"><div><div className="eyebrow">Gemini Intelligence</div><h2>Monitoramento, economia de API e recuperação</h2><p>O monitor detecta mudanças localmente. O Gemini só é chamado quando existe um incidente relevante, respeitando cooldown.</p></div><span className={`config-state ${config?.geminiConfigured ? "ok" : "off"}`}>{config?.geminiConfigured ? "Conectado" : "Não configurado"}</span></div>
            <div className="settings-form">
              <label className="settings-field"><span>Gemini API Key</span><input type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder={config?.geminiConfigured ? "•••••••• chave salva ••••••••" : "GEMINI_API_KEY"} /></label>
              <label className="settings-field"><span>Modelo</span><input value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} /></label>

              <label className="toggle-setting"><div><Activity size={18} /><span><strong>Monitoramento inteligente</strong><small>Compara snapshots e detecta quedas, alterações de URL, deployments e erros de provider.</small></span></div><input type="checkbox" checked={monitoring} onChange={(e) => setMonitoring(e.target.checked)} /></label>
              <label className="toggle-setting"><div><Sparkles size={18} /><span><strong>Análise Gemini sob demanda</strong><small>Usa Gemini apenas em incidentes relevantes e respeita o intervalo mínimo configurado.</small></span></div><input type="checkbox" checked={smartAnalysis} onChange={(e) => setSmartAnalysis(e.target.checked)} /></label>
              <label className="toggle-setting recovery-toggle"><div><Zap size={18} /><span><strong>Recuperação automática protegida</strong><small>Se uma aplicação estava online e cair para offline/erro, o HostDeck analisa o contexto e pode executar Start/Resume. Apps pausadas nunca são religadas automaticamente.</small></span></div><input type="checkbox" checked={autoRecovery} onChange={(e) => setAutoRecovery(e.target.checked)} /></label>

              <div className="settings-grid-2">
                <label className="settings-field compact"><span>Intervalo de monitoramento</span><select value={interval} onChange={(e) => setIntervalValue(Number(e.target.value))}><option value={60}>1 minuto</option><option value={120}>2 minutos</option><option value={300}>5 minutos</option><option value={600}>10 minutos</option><option value={1800}>30 minutos</option></select></label>
                <label className="settings-field compact"><span>Cooldown do Gemini</span><select value={geminiCooldown} onChange={(e) => setGeminiCooldown(Number(e.target.value))}><option value={5}>5 minutos</option><option value={10}>10 minutos</option><option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={60}>1 hora</option></select></label>
                <label className="settings-field compact"><span>Cooldown de notificações</span><select value={notificationCooldown} onChange={(e) => setNotificationCooldown(Number(e.target.value))}><option value={5}>5 minutos</option><option value={10}>10 minutos</option><option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={60}>1 hora</option></select></label>
                <label className="settings-field compact"><span>Cooldown de recuperação</span><select value={recoveryCooldown} onChange={(e) => setRecoveryCooldown(Number(e.target.value))}><option value={5}>5 minutos</option><option value={10}>10 minutos</option><option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={60}>1 hora</option></select></label>
                <label className="settings-field compact"><span>Tentativas de recuperação / hora</span><select value={maxRecoveryAttempts} onChange={(e) => setMaxRecoveryAttempts(Number(e.target.value))}><option value={1}>1 tentativa</option><option value={2}>2 tentativas</option><option value={3}>3 tentativas</option></select></label>
              </div>

              <label className="toggle-setting"><div><BellRing size={18} /><span><strong>Notificar alterações informativas</strong><small>Desligado por padrão para evitar excesso de alertas. Quedas e incidentes continuam sendo notificados.</small></span></div><input type="checkbox" checked={notifyInfoChanges} onChange={(e) => setNotifyInfoChanges(e.target.checked)} /></label>

              <div className="recovery-note"><ShieldCheck size={19} /><div><strong>Proteções da recuperação automática</strong><p>Somente transições <b>Online → Offline/Erro</b> são elegíveis. Pausas e builds são ignorados, ações manuais feitas pelo HostDeck entram em supressão e existe limite de tentativas por hora.</p></div></div>
              <button className="btn primary settings-save" onClick={saveIntelligence} disabled={!desktop || saving}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Salvar Inteligência</button>
            </div>
          </>}

          {tab === "notifications" && <>
            <div className="settings-section-head"><div><div className="eyebrow">Notifications</div><h2>Discord Webhook</h2><p>Envie apenas alertas relevantes para um canal do Discord, com severidade, aplicação afetada e recomendações.</p></div><span className={`config-state ${config?.discordConfigured ? "ok" : "off"}`}>{config?.discordConfigured ? "Webhook salvo" : "Não configurado"}</span></div>
            <div className="settings-form">
              <label className="settings-field"><span>Webhook URL</span><input type="password" value={discordUrl} onChange={(e) => setDiscordUrl(e.target.value)} placeholder={config?.discordConfigured ? "•••••••• webhook salvo ••••••••" : "https://discord.com/api/webhooks/..."} /></label>
              <label className="toggle-setting"><div><Webhook size={18} /><span><strong>Enviar alertas ao Discord</strong><small>Usa o mesmo resumo do Intelligence Inbox e respeita o cooldown de notificações.</small></span></div><input type="checkbox" checked={discordEnabled} onChange={(e) => setDiscordEnabled(e.target.checked)} /></label><label className="toggle-setting"><div><Activity size={18} /><span><strong>Gráfico de status no Discord</strong><small>Inclui barras de Online, Offline, Build, Pausado e Erro, além do resumo por hospedagem.</small></span></div><input type="checkbox" checked={discordStatusGraph} onChange={(e) => setDiscordStatusGraph(e.target.checked)} disabled={!discordEnabled} /></label><label className="toggle-setting"><div><MonitorCog size={18} /><span><strong>Discord Rich Presence</strong><small>Mostra HostDeck, hospedagem/aplicação selecionada e tempo de atividade no seu perfil do Discord. Desative para limpar o status.</small></span></div><input type="checkbox" checked={discordRpcEnabled} onChange={(e) => setDiscordRpcEnabled(e.target.checked)} /></label><label className="settings-field"><span>Discord Application ID</span><input value={discordRpcClientId} onChange={(e) => setDiscordRpcClientId(e.target.value.replace(/\D/g, ""))} placeholder="Client ID do app HostDeck no Discord Developer Portal" /><small>Para imagens no Rich Presence, cadastre assets com as chaves <code>hostdeck</code> e os IDs dos provedores (ex.: <code>vercel</code>, <code>discloud</code>).</small></label>
              <div className="settings-actions"><button className="btn glass" onClick={testDiscord} disabled={!desktop || saving || !config?.discordConfigured}>Enviar teste</button><button className="btn primary" onClick={saveDiscord} disabled={!desktop || saving}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Salvar webhook</button></div>
            </div>
          </>}

          {tab === "appearance" && <>
            <div className="settings-section-head"><div><div className="eyebrow">Appearance</div><h2>Tema e interface</h2><p>Glassmorphism adaptativo com Dark, Light ou sincronização automática com o sistema.</p></div></div>
            <div className="theme-showcase"><button className={theme === "system" ? "active" : ""} onClick={() => onThemeChange("system")}><Monitor size={24} /><strong>Sistema</strong><span>Segue o Windows/macOS/Linux</span></button><button className={theme === "dark" ? "active" : ""} onClick={() => onThemeChange("dark")}><Moon size={24} /><strong>Dark</strong><span>Contraste focado em operação</span></button><button className={theme === "light" ? "active" : ""} onClick={() => onThemeChange("light")}><Sun size={24} /><strong>Light</strong><span>Interface clara e suave</span></button></div>
            <div className="settings-section-head media-settings-head"><div><div className="eyebrow">Local media</div><h2>Banner e logo por arquivo</h2><p>As imagens ficam gravadas no armazenamento local do HostDeck e continuam disponíveis depois de reiniciar ou atualizar o aplicativo. Nenhum link externo é necessário.</p></div></div>
            <div className="media-settings-grid"><MediaUploadCard kind="banner" title="Banner do dashboard" description="Envie o arquivo do banner aqui. Não use link externo; a imagem fica salva localmente no HostDeck." /><MediaUploadCard kind="app" title="Logo padrão das aplicações" description="Envie o arquivo da logo aqui. Não use link externo; a imagem fica salva localmente no HostDeck." /></div>
          </>}

          {tab === "updates" && <>
            <div className="settings-section-head"><div><div className="eyebrow">Desktop lifecycle</div><h2>Atualizações</h2><p>O HostDeck verifica novas versões sozinho enquanto estiver em execução e pode continuar em segundo plano quando a janela é fechada.</p></div></div>
            <div className="settings-form update-settings-form">
              <label className="toggle-setting"><div><RefreshCw size={18} /><span><strong>Verificar atualizações automaticamente</strong><small>Consulta o GitHub ao iniciar e depois no intervalo configurado. Se houver versão nova, você recebe uma notificação.</small></span></div><input type="checkbox" checked={automaticUpdates} onChange={(e) => setAutomaticUpdates(e.target.checked)} /></label>
              <label className="toggle-setting"><div><Download size={18} /><span><strong>Baixar atualização automaticamente</strong><small>Quando uma versão nova for encontrada, baixa em segundo plano e instala ao sair ou quando você clicar em Instalar.</small></span></div><input type="checkbox" checked={automaticDownload} onChange={(e) => setAutomaticDownload(e.target.checked)} disabled={!automaticUpdates} /></label>
              <label className="toggle-setting"><div><Activity size={18} /><span><strong>Continuar em segundo plano ao fechar</strong><small>O X esconde a janela na bandeja, mantendo monitoramento e atualizações ativos. Para encerrar completamente, use “Sair do HostDeck” no ícone da bandeja.</small></span></div><input type="checkbox" checked={backgroundMode} onChange={(e) => setBackgroundMode(e.target.checked)} /></label>
              <label className="toggle-setting"><div><Monitor size={18} /><span><strong>Iniciar com o Windows</strong><small>Abre o HostDeck automaticamente no login. Com o modo em segundo plano, ele pode verificar atualizações sem você abrir a janela.</small></span></div><input type="checkbox" checked={launchAtLogin} onChange={(e) => setLaunchAtLogin(e.target.checked)} /></label>
              <label className="settings-field compact"><span>Intervalo de verificação</span><select value={updateCheckMinutes} onChange={(e) => setUpdateCheckMinutes(Number(e.target.value))} disabled={!automaticUpdates}><option value={10}>10 minutos</option><option value={30}>30 minutos</option><option value={60}>1 hora</option><option value={180}>3 horas</option><option value={360}>6 horas</option></select><small>Evita consultas excessivas ao GitHub.</small></label>
              <div className="update-background-note"><ShieldCheck size={18} /><div><strong>Aplicativo realmente encerrado</strong><p>Se o processo estiver totalmente fechado, ele não consegue verificar uma release nova. Para ter comportamento “fechado”, mantenha o modo em segundo plano ativado: a janela some, mas o agente continua na bandeja.</p></div></div><div className="desktop-lifecycle-actions"><button className="btn glass" onClick={() => desktop?.hideToTray?.()} disabled={!desktop}><Minimize2 size={15} />Ocultar na bandeja agora</button><button className="btn danger-ghost" onClick={() => desktop?.quitApp?.()} disabled={!desktop}><X size={15} />Encerrar HostDeck completamente</button></div>
              <button className="btn primary settings-save" onClick={saveUpdates} disabled={!desktop || saving}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Salvar atualizações</button>
            </div>
            <div className="update-panel"><span className="update-icon"><Download size={24} /></span><div><strong>HostDeck Desktop</strong><p>Verifique, baixe e instale a versão mais recente sem sair do app.</p></div><UpdateButton /></div><div className="windows-integration-card"><div><strong>Integração com o Windows</strong><p>Recria os atalhos da Área de Trabalho e Menu Iniciar apontando para o HostDeck.exe instalado, com o AppUserModelID e o ícone corretos.</p></div><button className="btn glass" onClick={repairWindowsShortcuts} disabled={!desktop || saving}><RefreshCw size={15} />Reparar atalhos</button></div><UpdateDetailsPanel />
          </>}
        </div>

        {message && <div className="settings-message">{message}</div>}
      </section>
    </div>
    {selectedPlugin && <PluginSetupModal plugin={selectedPlugin} status={config} onClose={() => setSelectedPlugin(null)} onSaved={(next) => { setConfig(next); setSelectedPlugin(null); setMessage(`Integração ${selectedPlugin.name} concluída com sucesso.`); }} />}
  </div>;
}

type WorkspaceEntry = { name: string; path: string; type: "file" | "directory"; size?: number; modified?: string };
type WorkspaceList = { cwd: string; entries: WorkspaceEntry[]; capabilities?: { read?: boolean; write?: boolean; upload?: boolean; deployZip?: boolean } };

function WorkspaceModal({ app, onClose, onToast }: { app: HostingApp; onClose: () => void; onToast: (message: string) => void }) {
  const toastRef = useRef(onToast);
  const [mounted, setMounted] = useState(false);
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState("Carregue os logs quando precisar.");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const deployRef = useRef<HTMLInputElement | null>(null);
  const base = `/api/workspace/${app.provider}/${encodeURIComponent(app.id)}`;
  const dirty = Boolean(selectedPath) && content !== savedContent;
  useEffect(() => { toastRef.current = onToast; }, [onToast]);

  const list = useCallback(async (path = "") => {
    setBusy(true);
    try {
      const response = await fetch(`${base}?action=list&path=${encodeURIComponent(path)}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao listar arquivos.");
      setCwd(json.cwd || path); setEntries(json.entries || []);
    } catch (error) { toastRef.current(error instanceof Error ? error.message : "Falha ao listar arquivos."); }
    finally { setBusy(false); }
  }, [base]);

  useEffect(() => { setMounted(true); list(""); }, [base, list]);
  async function openEntry(entry: WorkspaceEntry) {
    if (entry.type === "directory") { setSelectedPath(""); setContent(""); setSavedContent(""); await list(entry.path); return; }
    setBusy(true);
    try {
      const response = await fetch(`${base}?action=open&path=${encodeURIComponent(entry.path)}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao abrir arquivo.");
      setSelectedPath(entry.path); setContent(json.content || ""); setSavedContent(json.content || "");
    } catch (error) { onToast(error instanceof Error ? error.message : "Falha ao abrir arquivo."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!selectedPath || !dirty) return;
    setBusy(true);
    try {
      const response = await fetch(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: selectedPath, content }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao salvar.");
      setSavedContent(content); onToast(`${selectedPath} salvo.`);
    } catch (error) { onToast(error instanceof Error ? error.message : "Falha ao salvar."); }
    finally { setBusy(false); }
  }
  async function loadLogs() {
    try { const response = await fetch(`/api/apps/${app.provider}/${encodeURIComponent(app.id)}/logs`, { cache: "no-store" }); const json = await response.json(); if (!response.ok) throw new Error(json.error || "Falha ao carregar logs"); setLogs(json.logs || "Sem logs."); }
    catch (error) { setLogs(error instanceof Error ? error.message : "Falha ao carregar logs."); }
  }
  function upload(file?: File, action: "upload" | "deploy" = "upload") {
    if (!file) return;
    const xhr = new XMLHttpRequest(); const form = new FormData();
    form.set("action", action); form.set("path", cwd); form.set("file", file); setUploadProgress(0);
    xhr.open("POST", base);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => { let result: any = {}; try { result = JSON.parse(xhr.responseText || "{}"); } catch {} if (xhr.status >= 200 && xhr.status < 300) { setUploadProgress(100); onToast(action === "deploy" ? `Deploy enviado para ${providerName(app.provider)}.` : `Arquivo enviado para ${providerName(app.provider)}.`); window.setTimeout(() => { setUploadProgress(null); list(cwd); }, 700); } else { setUploadProgress(null); onToast(result.error || `Upload falhou (HTTP ${xhr.status}).`); } if (uploadRef.current) uploadRef.current.value = ""; if (deployRef.current) deployRef.current.value = ""; };
    xhr.onerror = () => { setUploadProgress(null); onToast("Falha de rede durante o upload."); }; xhr.send(form);
  }
  function upOneLevel() { const parts = cwd.split("/").filter(Boolean); parts.pop(); list(parts.join("/")); }
  if (!mounted) return null;
  return createPortal(<div className="modal-backdrop workspace-backdrop" onMouseDown={onClose}><section className="workspace-modal glass-modal" onMouseDown={(event) => event.stopPropagation()}>
    <header className="workspace-head"><div className="log-app"><AppArtwork app={app} /><div><ProviderBadge provider={app.provider} /><h2>{app.name} · Workspace</h2><small>{app.provider === "square" ? "File Manager + editor + upload + deploy ZIP" : app.provider === "discloud" ? "Explorer remoto + editor + deploy ZIP" : "WebDAV + editor + upload"}</small></div></div><div className="modal-actions"><button className="btn glass" onClick={() => list(cwd)} disabled={busy}><RefreshCw className={busy ? "spin" : ""} size={14} />Atualizar</button><button className="close-btn" onClick={onClose}><X size={17} /></button></div></header>
    <div className="workspace-body"><aside className="workspace-tree"><div className="workspace-path"><button onClick={() => list("")}>root</button>{cwd && <><ChevronRight size={12} /><span>{cwd}</span></>}</div>{cwd && <button className="workspace-entry directory up" onClick={upOneLevel}><FolderOpen size={15} /><span>..</span></button>}<div className="workspace-entry-list">{entries.map((entry) => <button key={entry.path} className={`workspace-entry ${entry.type} ${selectedPath === entry.path ? "active" : ""}`} onClick={() => openEntry(entry)}>{entry.type === "directory" ? <FolderOpen size={15} /> : <FileCode2 size={15} />}<span>{entry.name}</span>{entry.size ? <small>{Math.max(1, Math.round(entry.size / 1024))} KB</small> : null}</button>)}</div>{!entries.length && !busy && <div className="workspace-empty">Nenhum arquivo retornado nesta pasta.</div>}</aside>
    <main className="workspace-editor"><div className="editor-tabbar"><span><FileCode2 size={14} />{selectedPath || "Selecione um arquivo"}</span>{dirty && <b>modificado</b>}<button className="btn primary mini" onClick={save} disabled={!dirty || busy}><Save size={13} />Salvar</button></div>{selectedPath ? <textarea className="code-editor" spellCheck={false} value={content} onChange={(event) => setContent(event.target.value)} /> : <div className="editor-empty"><FileCode2 size={34} /><h3>Editor do HostDeck</h3><p>Abra um arquivo na árvore à esquerda para editar o conteúdo sem sair do painel.</p></div>}</main>
    <aside className="workspace-side"><section><header><Upload size={14} />Upload / Deploy</header><p>{app.provider === "square" ? "Envie arquivos individuais para a pasta atual ou um .ZIP para atualizar toda a aplicação pela API de commit da Square Cloud." : app.provider === "discloud" ? "Envie um .ZIP para atualizar o código desta aplicação pela API de commit da Discloud." : "Envie arquivos diretamente para a pasta atual do Nextcloud."}</p><div className="workspace-upload-actions">{app.provider !== "discloud" && <label className="btn primary workspace-upload">Selecionar arquivo<input ref={uploadRef} type="file" onChange={(event) => upload(event.target.files?.[0], "upload")} /></label>}{(app.provider === "square" || app.provider === "discloud") && <label className="btn glass workspace-upload">Deploy ZIP<input ref={deployRef} type="file" accept=".zip,application/zip" onChange={(event) => upload(event.target.files?.[0], "deploy")} /></label>}</div>{uploadProgress !== null && <div className="upload-progress"><div><span style={{ width: `${uploadProgress}%` }} /></div><strong>{uploadProgress}%</strong></div>}</section><section className="workspace-logs"><header><SquareTerminal size={14} />Logs</header><button className="btn glass mini" onClick={loadLogs}>Carregar logs</button><pre>{logs}</pre></section></aside></div>
    <footer className="workspace-footer"><span>{app.provider === "square" ? "Square Cloud File Manager" : app.provider === "discloud" ? "Discloud Explorer API" : "Nextcloud WebDAV"}</span><span>{cwd ? `/${cwd}` : "/"}</span></footer>
  </section></div>, document.body);
}

function LogsModal({ app, onClose }: { app: HostingApp; onClose: () => void }) {
  const [logs, setLogs] = useState("Carregando logs…");
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const eventRef = useRef<EventSource | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(""); try { const r = await fetch(`/api/apps/${app.provider}/${encodeURIComponent(app.id)}/logs`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Falha ao buscar logs"); setLogs(j.logs || "Sem logs."); } catch (e) { setError(e instanceof Error ? e.message : "Falha ao buscar logs"); } finally { setLoading(false); } }, [app.provider, app.id]);
  useEffect(() => { setMounted(true); load(); return () => eventRef.current?.close(); }, [load]);
  function liveStart() { if (app.provider !== "square") return; eventRef.current?.close(); const es = new EventSource(`/api/apps/square/${encodeURIComponent(app.id)}/realtime`); eventRef.current = es; setLive(true); es.onmessage = (event) => setLogs((prev) => `${prev}\n${event.data}`.trim()); es.addEventListener("logs", (event) => { const raw = String((event as MessageEvent).data || ""); const first = raw.charCodeAt(0); setLogs((prev) => `${prev}\n${first === 2 ? "[stderr] " : ""}${first === 1 || first === 2 ? raw.slice(1) : raw}`.trim()); }); es.onerror = () => { setLive(false); es.close(); }; }
  if (!mounted) return null;
  return createPortal(<div className="modal-backdrop logs-backdrop" onMouseDown={onClose}><section className="logs-modal glass-modal" onMouseDown={(e) => e.stopPropagation()}><header><div className="log-app"><AppArtwork app={app} /><div><ProviderBadge provider={app.provider} /><h2>{app.name}</h2></div></div><div className="modal-actions">{app.provider === "square" && <button className="btn glass" onClick={liveStart} disabled={live}><Activity size={14} />{live ? "Ao vivo" : "Live"}</button>}<button className="btn glass" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={14} />Atualizar</button><button className="close-btn" onClick={onClose}><X size={17} /></button></div></header>{error && <div className="settings-error logs-error">{error}</div>}<pre>{logs}</pre><footer><span>{live ? "STREAM CONECTADO" : "SNAPSHOT"}</span><span>{providerName(app.provider)}</span></footer></section></div>, document.body);
}

export default function Dashboard() {
  const [data, setData] = useState<AppsResponse>({ apps: [], providers: [], fetchedAt: 0 }); const [loading, setLoading] = useState(true); const [page, setPage] = useState<Page>("overview"); const [appsProvider, setAppsProvider] = useState<"all" | Provider>("all"); const [settingsTab, setSettingsTab] = useState<SettingsTab>("plugins"); const [theme, setTheme] = useState<ThemeChoice>("system"); const [desktop, setDesktop] = useState(false); const [config, setConfig] = useState<DesktopConfigStatus | null>(null); const [monitor, setMonitor] = useState<MonitorState | null>(null); const [unread, setUnread] = useState(0); const [flyout, setFlyout] = useState<Insight | null>(null); const [logsApp, setLogsApp] = useState<HostingApp | null>(null); const [workspaceApp, setWorkspaceApp] = useState<HostingApp | null>(null); const [presenceApp, setPresenceApp] = useState<HostingApp | null>(null); const [pending, setPending] = useState<Record<string, PendingAction>>({}); const [toast, setToast] = useState(""); const flyoutTimer = useRef<number | null>(null);

  useEffect(() => {
    setDesktop(Boolean(window.hostDeckDesktop));
    const stored = localStorage.getItem("hostdeck-theme") as ThemeChoice | null;
    if (["system", "dark", "light"].includes(stored || "")) setTheme(stored!);
    const storedPage = localStorage.getItem("hostdeck-page") as Page | null;
    if (["overview", "apps", "ai", "settings"].includes(storedPage || "")) setPage(storedPage!);
    const storedTab = localStorage.getItem("hostdeck-settings-tab") as SettingsTab | null;
    if (["plugins", "ai", "notifications", "appearance", "updates"].includes(storedTab || "")) setSettingsTab(storedTab!);
  }, []);
  useEffect(() => { localStorage.setItem("hostdeck-page", page); }, [page]);
  useEffect(() => { localStorage.setItem("hostdeck-settings-tab", settingsTab); }, [settingsTab]);
  useEffect(() => { const media = window.matchMedia("(prefers-color-scheme: dark)"); const apply = () => { document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme; localStorage.setItem("hostdeck-theme", theme); }; apply(); media.addEventListener("change", apply); return () => media.removeEventListener("change", apply); }, [theme]);

  const loadApps = useCallback(async (silent = false) => { if (!silent) setLoading(true); try { const r = await fetch("/api/apps", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Falha ao atualizar"); setData(j); } catch (e) { setToast(e instanceof Error ? e.message : "Falha ao atualizar aplicações"); } finally { if (!silent) setLoading(false); } }, []);
  useEffect(() => { loadApps(); const timer = window.setInterval(() => loadApps(true), 15000); return () => window.clearInterval(timer); }, [loadApps]);

  useEffect(() => {
    const api = window.hostDeckDesktop; if (!api) return;
    let active = true;
    api.getConfigStatus().then((v) => active && setConfig(v));
    api.getMonitorState().then((v) => { if (!active) return; setMonitor(v); const lastSeen = localStorage.getItem("hostdeck-ai-last-seen"); const count = (v.history || []).filter((item) => !item.silent && (!lastSeen || (item.checkedAt || "") > lastSeen)).length; setUnread(count); });
    const offState = api.onMonitorStatus((state) => active && setMonitor(state));
    const offAlert = api.onMonitorAlert((insight) => { if (!active) return; setMonitor((current) => current ? { ...current, lastInsight: insight, history: [insight, ...(current.history || []).filter((item) => item.id !== insight.id)] } : current); setUnread((value) => value + 1); setFlyout(insight); if (flyoutTimer.current) window.clearTimeout(flyoutTimer.current); flyoutTimer.current = window.setTimeout(() => setFlyout(null), 9000); });
    const offOpen = api.onOpenAiInbox(() => { setPage("ai"); setUnread(0); localStorage.setItem("hostdeck-ai-last-seen", new Date().toISOString()); });
    return () => { active = false; offState(); offAlert(); offOpen(); if (flyoutTimer.current) window.clearTimeout(flyoutTimer.current); };
  }, [desktop]);

  useEffect(() => {
    const api = window.hostDeckDesktop;
    if (!api?.setDiscordActivity) return;
    if (page === "apps" && presenceApp) {
      api.setDiscordActivity({ provider: presenceApp.provider, providerName: providerName(presenceApp.provider), appName: presenceApp.name, status: statusLabel(presenceApp.status), startedAt: Date.now() }).catch(() => {});
      return;
    }
    if (page === "apps" && appsProvider !== "all") {
      api.setDiscordActivity({ provider: appsProvider, providerName: providerName(appsProvider), startedAt: Date.now() }).catch(() => {});
      return;
    }
    api.setDiscordActivity({ startedAt: Date.now() }).catch(() => {});
  }, [page, appsProvider, presenceApp?.provider, presenceApp?.id, presenceApp?.status]);

  function go(target: Page) { setPage(target); if (target === "ai") { setUnread(0); localStorage.setItem("hostdeck-ai-last-seen", new Date().toISOString()); } }
  function openSettings(tab: SettingsTab = "plugins") { setSettingsTab(tab); setPage("settings"); }

  function expected(app: HostingApp | undefined, action: AppAction, elapsed: number) { if (!app) return false; if (action === "start") return app.status === "online"; if (action === "stop") return app.status === "offline"; if (action === "pause") return app.status === "paused"; if (action === "resume") return app.status === "online" || app.status === "building"; return action === "restart" && elapsed > 2500 && app.status === "online"; }
  async function runAction(app: HostingApp, action: AppAction) {
    const key = appKey(app);
    if (pending[key]) return;
    const startedAt = Date.now();
    setPending((current) => ({ ...current, [key]: { action, startedAt } }));
    try {
      await window.hostDeckDesktop?.recordManualAction({ provider: app.provider, id: app.id, action }).catch(() => undefined);
      const response = await fetch(`/api/apps/${app.provider}/${encodeURIComponent(app.id)}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Falha ao executar ação");

      let confirmed = false;
      let lastDetails: Partial<HostingApp> | null = null;
      for (let i = 0; i < 18; i += 1) {
        await sleep(i ? 1500 : 800);
        const r = await fetch(`/api/apps/${app.provider}/${encodeURIComponent(app.id)}/details`, { cache: "no-store" });
        if (!r.ok) continue;
        const j = await r.json();
        lastDetails = j.details || {};
        setData((current) => ({ ...current, apps: current.apps.map((item) => appKey(item) === key ? { ...item, ...lastDetails, actions: lastDetails?.actions ?? item.actions } : item), fetchedAt: Date.now() }));
        if (expected({ ...app, ...lastDetails, actions: lastDetails?.actions ?? app.actions }, action, Date.now() - startedAt)) { confirmed = true; break; }
      }

      await loadApps(true);
      if (lastDetails) {
        setData((current) => ({ ...current, apps: current.apps.map((item) => appKey(item) === key ? { ...item, ...lastDetails, actions: lastDetails?.actions ?? item.actions } : item), fetchedAt: Date.now() }));
      }
      setToast(confirmed ? `${app.name}: estado confirmado como ${lastDetails?.status ? statusLabel(lastDetails.status) : ACTION_LABEL[action]}.` : `${app.name}: comando aceito, mas o provedor ainda não confirmou o estado final.`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Falha ao executar ação");
    } finally {
      setPending((current) => { const next = { ...current }; delete next[key]; return next; });
      window.setTimeout(() => setToast(""), 5000);
    }
  }

  const providerCounts = useMemo(() => new Map(HOSTING_PLUGINS.map((plugin) => [plugin.id, data.apps.filter((app) => app.provider === plugin.id).length])), [data.apps]);
  const connected = data.providers.filter((p) => p.configured);

  return <div className={desktop ? "desktop-app" : "browser-app"}><WindowChrome /><main className="shell"><aside className="sidebar glass-sidebar"><div className="brand"><BrandMark size={40} /><div><strong>Host<span>Deck</span></strong><small>Infrastructure OS</small></div></div><div className="sidebar-label">Workspace</div><nav><NavButton active={page === "overview"} icon={<LayoutDashboard size={18} />} label="Visão geral" onClick={() => go("overview")} /><NavButton active={page === "apps" && appsProvider === "all"} icon={<AppWindow size={18} />} label="Aplicações" badge={data.apps.length} onClick={() => { setPresenceApp(null); setAppsProvider("all"); go("apps"); }} /><NavButton active={page === "ai"} icon={<Sparkles size={18} />} label="Inteligência" dangerBadge={unread} onClick={() => go("ai")} /></nav>{connected.length > 0 && <><div className="sidebar-label">Hospedagens</div><nav className="provider-nav">{connected.map((item) => <button key={item.provider} className={`nav-item provider-shortcut ${page === "apps" && appsProvider === item.provider ? "active" : ""}`} onClick={() => { setPresenceApp(null); setAppsProvider(item.provider); go("apps"); }}><span className={`nav-icon provider-${item.provider}`}><ProviderMark provider={item.provider} size={16} /></span><span>{PLUGIN_BY_ID.get(item.provider)?.shortName}</span><b>{providerCounts.get(item.provider) || 0}</b></button>)}</nav></>}<div className="sidebar-label">Sistema</div><nav><NavButton active={page === "settings"} icon={<Settings size={18} />} label="Configurações" onClick={() => openSettings("plugins")} /></nav><div className="sidebar-bottom"><div className="security-note"><ShieldCheck size={15} /><span>Secrets protegidos no backend local</span></div><div className="local-badge"><span />LOCAL CONTROL PLANE</div></div></aside><section className="content"><header className="global-topbar"><div className="global-context"><span>{page === "overview" ? "Dashboard" : page === "apps" ? "Aplicações" : page === "ai" ? "Intelligence Inbox" : "Configurações"}</span><small>HostDeck Workspace</small></div><div className="global-actions"><ThemeControl value={theme} onChange={setTheme} /><UpdateButton /><button className="top-icon-btn" onClick={() => openSettings("plugins")} title="Configurações"><Settings size={16} /></button></div></header>{page === "overview" && <OverviewPage data={data} monitor={monitor} onOpenApps={() => go("apps")} onOpenAi={() => go("ai")} onOpenSettings={() => openSettings("plugins")} />}{page === "apps" && <ApplicationsPage data={data} loading={loading} pending={pending} provider={appsProvider} onProviderChange={setAppsProvider} onAction={runAction} onLogs={setLogsApp} onWorkspace={setWorkspaceApp} onSelectionChange={setPresenceApp} onRefresh={() => loadApps()} onToast={setToast} />}{page === "ai" && <AiInboxPage data={data} monitor={monitor} onMonitorChange={setMonitor} config={config} onOpenSettings={() => openSettings("ai")} />}{page === "settings" && <SettingsPage key={settingsTab} theme={theme} onThemeChange={setTheme} config={config} setConfig={setConfig} data={data} initialTab={settingsTab} />}</section></main>{logsApp && <LogsModal app={logsApp} onClose={() => setLogsApp(null)} />}{workspaceApp && <WorkspaceModal app={workspaceApp} onClose={() => setWorkspaceApp(null)} onToast={(message) => { setToast(message); window.setTimeout(() => setToast(""), 5000); }} />}{flyout && <div role="button" tabIndex={0} className={`alert-flyout glass-card ${flyout.severity}`} onClick={() => { setFlyout(null); go("ai"); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setFlyout(null); go("ai"); } }}><span className="alert-flyout-icon"><BellRing size={17} /></span><div><small>Novo alerta · Intelligence</small><strong>{flyout.headline}</strong><p>{flyout.summary}</p><span>Abrir conversa <ChevronRight size={13} /></span></div><button className="flyout-close" onClick={(e) => { e.stopPropagation(); setFlyout(null); }}><X size={13} /></button></div>}{toast && <div className="toast glass-card">{toast}</div>}</div>;
}
