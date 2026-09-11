import { fetchJson, ensureHttpUrl } from "@/lib/http";
import type { HostingApp, ProviderResult } from "@/lib/types";

const BASE = "https://api.netlify.com/api/v1";

type NetlifySite = {
  id: string;
  name?: string;
  state?: string;
  url?: string;
  ssl_url?: string;
  created_at?: string;
  updated_at?: string;
  published_deploy?: { id?: string; state?: string; framework?: string; published_at?: string; error_message?: string };
  build_settings?: { framework?: string; provider?: string; repo_url?: string };
};

function headers() {
  const token = process.env.NETLIFY_TOKEN;
  if (!token) throw new Error("NETLIFY_TOKEN não configurado");
  return { Authorization: `Bearer ${token}` };
}

function statusOf(site: NetlifySite): HostingApp["status"] {
  const state = site.published_deploy?.state || site.state || "";
  if (state === "ready" || state === "current") return "online";
  if (["building", "enqueued", "uploading", "processing", "preparing"].includes(state)) return "building";
  if (state === "error") return "error";
  return site.ssl_url || site.url ? "online" : "unknown";
}

export async function listNetlifyApps(): Promise<ProviderResult> {
  if (!process.env.NETLIFY_TOKEN) return { provider: "netlify", configured: false, apps: [] };
  try {
    const sites = await fetchJson<NetlifySite[]>(`${BASE}/sites?per_page=100`, { headers: headers() });
    const apps: HostingApp[] = (sites ?? []).map((site) => ({
      id: site.id,
      provider: "netlify",
      name: site.name || site.id,
      status: statusOf(site),
      url: ensureHttpUrl(site.ssl_url || site.url),
      language: site.published_deploy?.framework || site.build_settings?.framework || undefined,
      createdAt: site.created_at,
      updatedAt: site.updated_at ? new Date(site.updated_at).getTime() : undefined,
      latestDeploymentId: site.published_deploy?.id,
      latestDeploymentState: site.published_deploy?.state,
      description: site.published_deploy?.error_message || "Site publicado na Netlify",
      actions: [],
    }));
    return { provider: "netlify", configured: true, apps };
  } catch (error) {
    return { provider: "netlify", configured: true, apps: [], error: error instanceof Error ? error.message : "Falha na Netlify" };
  }
}

export async function getNetlifyAppDetails(id: string): Promise<Partial<HostingApp>> {
  const site = await fetchJson<NetlifySite>(`${BASE}/sites/${encodeURIComponent(id)}`, { headers: headers() });
  return { status: statusOf(site), url: ensureHttpUrl(site.ssl_url || site.url), language: site.published_deploy?.framework || site.build_settings?.framework, latestDeploymentId: site.published_deploy?.id, latestDeploymentState: site.published_deploy?.state, updatedAt: site.updated_at ? new Date(site.updated_at).getTime() : undefined };
}
