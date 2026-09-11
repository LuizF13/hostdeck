import { fetchJson, ensureHttpUrl } from "@/lib/http";
import type { HostingApp, ProviderResult } from "@/lib/types";

const BASE = "https://api.digitalocean.com/v2/apps";

type DODeployment = { id?: string; phase?: string; created_at?: string; updated_at?: string };
type DOApp = { id: string; spec?: { name?: string; region?: string; services?: Array<{ environment_slug?: string }> }; default_ingress?: string; live_url?: string; created_at?: string; updated_at?: string; active_deployment?: DODeployment; in_progress_deployment?: DODeployment; region?: { slug?: string } };
type DOResponse = { apps?: DOApp[] };

function headers() {
  const token = process.env.DIGITALOCEAN_TOKEN;
  if (!token) throw new Error("DIGITALOCEAN_TOKEN não configurado");
  return { Authorization: `Bearer ${token}` };
}

function statusOf(app: DOApp): HostingApp["status"] {
  const phase = app.in_progress_deployment?.phase || app.active_deployment?.phase || "";
  if (["ACTIVE", "SUPERSEDED"].includes(phase)) return "online";
  if (["PENDING_BUILD", "BUILDING", "PENDING_DEPLOY", "DEPLOYING"].includes(phase)) return "building";
  if (["ERROR", "CANCELED"].includes(phase)) return "error";
  return app.default_ingress || app.live_url ? "online" : "unknown";
}

export async function listDigitalOceanApps(): Promise<ProviderResult> {
  if (!process.env.DIGITALOCEAN_TOKEN) return { provider: "digitalocean", configured: false, apps: [] };
  try {
    const data = await fetchJson<DOResponse>(BASE, { headers: headers() });
    const apps: HostingApp[] = (data.apps ?? []).map((app) => ({
      id: app.id,
      provider: "digitalocean",
      name: app.spec?.name || app.id,
      status: statusOf(app),
      url: ensureHttpUrl(app.live_url || app.default_ingress),
      region: app.spec?.region || app.region?.slug,
      language: app.spec?.services?.[0]?.environment_slug,
      createdAt: app.created_at,
      updatedAt: app.updated_at ? new Date(app.updated_at).getTime() : undefined,
      latestDeploymentId: app.in_progress_deployment?.id || app.active_deployment?.id,
      latestDeploymentState: app.in_progress_deployment?.phase || app.active_deployment?.phase,
      description: "Aplicação no DigitalOcean App Platform",
      actions: [],
    }));
    return { provider: "digitalocean", configured: true, apps };
  } catch (error) {
    return { provider: "digitalocean", configured: true, apps: [], error: error instanceof Error ? error.message : "Falha na DigitalOcean" };
  }
}

export async function getDigitalOceanAppDetails(id: string): Promise<Partial<HostingApp>> {
  const data = await fetchJson<{ app?: DOApp }>(`${BASE}/${encodeURIComponent(id)}`, { headers: headers() });
  const app = data.app;
  if (!app) return {};
  return { status: statusOf(app), url: ensureHttpUrl(app.live_url || app.default_ingress), region: app.spec?.region || app.region?.slug, latestDeploymentId: app.in_progress_deployment?.id || app.active_deployment?.id, latestDeploymentState: app.in_progress_deployment?.phase || app.active_deployment?.phase, updatedAt: app.updated_at ? new Date(app.updated_at).getTime() : undefined };
}
