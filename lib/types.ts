export type Provider =
  | "square"
  | "vercel"
  | "render"
  | "netlify"
  | "cloudflare"
  | "digitalocean"
  | "heroku";

export type AppStatus = "online" | "offline" | "paused" | "building" | "unknown" | "error";

export type AppAction = "start" | "stop" | "restart" | "pause" | "resume";

export interface HostingApp {
  id: string;
  provider: Provider;
  name: string;
  status: AppStatus;
  url?: string;
  description?: string;
  cpu?: string;
  ram?: string;
  storage?: string;
  network?: string;
  uptime?: number;
  language?: string;
  cluster?: string;
  region?: string;
  createdAt?: string;
  latestDeploymentId?: string;
  latestDeploymentState?: string;
  updatedAt?: number;
  logoUrl?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
  actions: AppAction[];
}

export interface ProviderResult {
  provider: Provider;
  configured: boolean;
  error?: string;
  apps: HostingApp[];
}

export interface PluginField {
  key: string;
  env: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  optional?: boolean;
  help?: string;
}

export interface HostingPluginDefinition {
  id: Provider;
  name: string;
  shortName: string;
  description: string;
  category: "hosting";
  docsUrl: string;
  portalUrl?: string;
  tokenGuide?: string[];
  color: string;
  fields: PluginField[];
  capabilities: string[];
}
