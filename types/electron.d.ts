export {};

import type { Provider } from "@/lib/types";

type HostDeckUpdateState = {
  state: "idle" | "checking" | "available" | "downloading" | "downloaded" | "up-to-date" | "error" | "unavailable";
  currentVersion?: string;
  availableVersion?: string;
  percent?: number;
  message?: string;
  releaseNotes?: string[];
};

type HostDeckInsight = {
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

type HostDeckMonitorState = {
  enabled: boolean;
  intervalSeconds: number;
  running: boolean;
  lastCheckedAt?: string | null;
  lastInsight?: HostDeckInsight | null;
  history?: HostDeckInsight[];
};

type PluginState = { configured: boolean; values?: Record<string, string> };

type HostDeckConfigStatus = {
  squareConfigured: boolean;
  vercelConfigured: boolean;
  vercelTeamId?: string;
  geminiConfigured: boolean;
  geminiModel?: string;
  discordConfigured?: boolean;
  discordNotificationsEnabled?: boolean;
  plugins?: Partial<Record<Provider, PluginState>>;
  aiMonitoringEnabled: boolean;
  smartAnalysisEnabled?: boolean;
  autoRecoveryEnabled?: boolean;
  notifyInfoChanges?: boolean;
  monitorIntervalSeconds: number;
  notificationCooldownMinutes?: number;
  geminiCooldownMinutes?: number;
  recoveryCooldownMinutes?: number;
  maxRecoveryAttemptsPerHour?: number;
  automaticUpdatesEnabled?: boolean;
  automaticUpdateDownload?: boolean;
  updateCheckMinutes?: number;
  backgroundModeEnabled?: boolean;
  launchAtLogin?: boolean;
  credentialPath?: string;
};

type HostDeckConfigInput = {
  squareToken?: string;
  vercelToken?: string;
  vercelTeamId?: string;
  geminiKey?: string;
  geminiModel?: string;
  discordWebhookUrl?: string;
  discordNotificationsEnabled?: boolean;
  aiMonitoringEnabled?: boolean;
  smartAnalysisEnabled?: boolean;
  autoRecoveryEnabled?: boolean;
  notifyInfoChanges?: boolean;
  monitorIntervalSeconds?: number;
  notificationCooldownMinutes?: number;
  geminiCooldownMinutes?: number;
  recoveryCooldownMinutes?: number;
  maxRecoveryAttemptsPerHour?: number;
  automaticUpdatesEnabled?: boolean;
  automaticUpdateDownload?: boolean;
  updateCheckMinutes?: number;
  backgroundModeEnabled?: boolean;
  launchAtLogin?: boolean;
  removeSquare?: boolean;
  removeVercel?: boolean;
  removeGemini?: boolean;
  removeDiscord?: boolean;
};

declare global {
  interface Window {
    hostDeckDesktop?: {
      getUpdateStatus(): Promise<HostDeckUpdateState>;
      checkForUpdates(): Promise<void>;
      downloadUpdate(): Promise<void>;
      installUpdate(): Promise<void>;
      onUpdateStatus(callback: (state: HostDeckUpdateState) => void): () => void;
      getConfigStatus(): Promise<HostDeckConfigStatus>;
      saveConfig(input: HostDeckConfigInput): Promise<HostDeckConfigStatus>;
      getPluginStatus(): Promise<HostDeckConfigStatus>;
      savePlugin(input: { id: Provider; values?: Record<string, string>; remove?: boolean }): Promise<HostDeckConfigStatus>;
      testDiscord(): Promise<{ ok: boolean }>;
      minimizeWindow(): Promise<void>;
      toggleMaximizeWindow(): Promise<boolean>;
      closeWindow(): Promise<void>;
      isWindowMaximized(): Promise<boolean>;
      repairWindowsShortcuts(): Promise<{ ok: boolean; executable?: string; appUserModelId?: string; results?: Array<{ shortcut: string; ok: boolean; error?: string }> }>;
      onWindowMaximized(callback: (value: boolean) => void): () => void;
      getMonitorState(): Promise<HostDeckMonitorState>;
      scanNow(): Promise<HostDeckMonitorState | void>;
      recordManualAction(input: { provider: Provider; id: string; action: string }): Promise<{ ok: boolean }>;
      onMonitorStatus(callback: (state: HostDeckMonitorState) => void): () => void;
      onMonitorAlert(callback: (insight: HostDeckInsight) => void): () => void;
      onOpenAiInbox(callback: (payload: { insightId?: string }) => void): () => void;
      getSystemTheme(): Promise<"dark" | "light">;
    };
  }
}
