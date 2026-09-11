import { fetchJson, ensureHttpUrl } from "@/lib/http";
import type { HostingApp, ProviderResult } from "@/lib/types";

const BASE = "https://api.heroku.com";

type HerokuApp = { id: string; name: string; web_url?: string; created_at?: string; updated_at?: string; maintenance?: boolean; stack?: { name?: string }; region?: { name?: string }; released_at?: string };

function headers() {
  const token = process.env.HEROKU_API_KEY;
  if (!token) throw new Error("HEROKU_API_KEY não configurada");
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.heroku+json; version=3" };
}

export async function listHerokuApps(): Promise<ProviderResult> {
  if (!process.env.HEROKU_API_KEY) return { provider: "heroku", configured: false, apps: [] };
  try {
    const list = await fetchJson<HerokuApp[]>(`${BASE}/apps`, { headers: headers() });
    const apps: HostingApp[] = (list ?? []).map((app) => ({
      id: app.id,
      provider: "heroku",
      name: app.name,
      status: app.maintenance ? "paused" : "online",
      url: ensureHttpUrl(app.web_url),
      language: app.stack?.name,
      region: app.region?.name,
      createdAt: app.created_at,
      updatedAt: app.updated_at ? new Date(app.updated_at).getTime() : undefined,
      description: app.maintenance ? "Maintenance mode ativo" : "Aplicação hospedada na Heroku",
      actions: [],
    }));
    return { provider: "heroku", configured: true, apps };
  } catch (error) {
    return { provider: "heroku", configured: true, apps: [], error: error instanceof Error ? error.message : "Falha na Heroku" };
  }
}

export async function getHerokuAppDetails(id: string): Promise<Partial<HostingApp>> {
  const app = await fetchJson<HerokuApp>(`${BASE}/apps/${encodeURIComponent(id)}`, { headers: headers() });
  return { status: app.maintenance ? "paused" : "online", url: ensureHttpUrl(app.web_url), language: app.stack?.name, region: app.region?.name, updatedAt: app.updated_at ? new Date(app.updated_at).getTime() : undefined };
}
