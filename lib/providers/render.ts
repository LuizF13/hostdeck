import { fetchJson, ensureHttpUrl } from "@/lib/http";
import type { HostingApp, ProviderResult } from "@/lib/types";

const BASE = "https://api.render.com/v1";

type RenderService = {
  id?: string;
  name?: string;
  type?: string;
  runtime?: string;
  region?: string;
  suspended?: string | boolean;
  createdAt?: string;
  updatedAt?: string;
  serviceDetails?: { url?: string; buildPlan?: string; env?: string; runtime?: string };
};

type RenderEntry = RenderService | { service?: RenderService; cursor?: string };

function token() {
  const value = process.env.RENDER_API_KEY;
  if (!value) throw new Error("RENDER_API_KEY não configurada");
  return value;
}

function normalize(entry: RenderEntry): RenderService {
  return "service" in entry && entry.service ? entry.service : entry as RenderService;
}

export async function listRenderApps(): Promise<ProviderResult> {
  if (!process.env.RENDER_API_KEY) return { provider: "render", configured: false, apps: [] };
  try {
    const raw = await fetchJson<RenderEntry[]>(`${BASE}/services?limit=100`, { headers: { Authorization: `Bearer ${token()}` } });
    const apps: HostingApp[] = (raw ?? []).map(normalize).filter((service) => service.id && service.name).map((service) => {
      const suspended = service.suspended === true || service.suspended === "suspended";
      return {
        id: service.id!,
        provider: "render",
        name: service.name!,
        status: suspended ? "paused" : "online",
        url: ensureHttpUrl(service.serviceDetails?.url),
        language: service.runtime || service.serviceDetails?.runtime || service.serviceDetails?.env || service.type,
        region: service.region,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt ? new Date(service.updatedAt).getTime() : undefined,
        description: service.type ? `${service.type.replaceAll("_", " ")} na Render` : "Serviço hospedado na Render",
        actions: [],
      };
    });
    return { provider: "render", configured: true, apps };
  } catch (error) {
    return { provider: "render", configured: true, apps: [], error: error instanceof Error ? error.message : "Falha na Render" };
  }
}

export async function getRenderAppDetails(id: string): Promise<Partial<HostingApp>> {
  const service = await fetchJson<RenderService>(`${BASE}/services/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token()}` } });
  const suspended = service.suspended === true || service.suspended === "suspended";
  return { status: suspended ? "paused" : "online", url: ensureHttpUrl(service.serviceDetails?.url), language: service.runtime || service.serviceDetails?.runtime || service.type, region: service.region, updatedAt: service.updatedAt ? new Date(service.updatedAt).getTime() : undefined };
}
