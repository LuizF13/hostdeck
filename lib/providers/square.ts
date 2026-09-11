import { fetchJson, ensureHttpUrl } from "@/lib/http";
import type { HostingApp, ProviderResult } from "@/lib/types";

const BASE = "https://api.squarecloud.app/v2";

interface SquareAccountResponse {
  status: string;
  response?: {
    applications?: Array<{
      id: string;
      name: string;
      desc?: string;
      ram?: number;
      lang?: string;
      domain?: string | null;
      custom?: string | null;
      cluster?: string;
      created_at?: string;
    }>;
  };
}


interface SquareAppStatusResponse {
  status: string;
  response?: {
    cpu?: string;
    ram?: string;
    status?: string;
    running?: boolean;
    storage?: string;
    network?: { total?: string; now?: string };
    uptime?: number;
  };
}

interface SquareStatusResponse {
  status: string;
  response?: Array<{
    id: string;
    cpu?: string;
    ram?: string;
    running?: boolean;
  }>;
}

export async function listSquareApps(): Promise<ProviderResult> {
  const token = process.env.SQUARECLOUD_API_KEY;
  if (!token) return { provider: "square", configured: false, apps: [] };

  try {
    const headers = { Authorization: token };
    const [account, statuses] = await Promise.all([
      fetchJson<SquareAccountResponse>(`${BASE}/users/me`, { headers }),
      fetchJson<SquareStatusResponse>(`${BASE}/apps/status`, { headers }),
    ]);

    const statusMap = new Map((statuses.response ?? []).map((s) => [s.id, s]));
    const apps: HostingApp[] = (account.response?.applications ?? []).map((app) => {
      const live = statusMap.get(app.id);
      const running = Boolean(live?.running);
      const url = ensureHttpUrl(app.custom || app.domain);
      return {
        id: app.id,
        provider: "square",
        name: app.name,
        description: app.desc,
        status: running ? "online" : "offline",
        url,
        cpu: live?.cpu,
        ram: live?.ram,
        language: app.lang,
        cluster: app.cluster,
        createdAt: app.created_at,
        actions: running ? ["stop", "restart"] : ["start"],
      };
    });

    return { provider: "square", configured: true, apps };
  } catch (error) {
    return {
      provider: "square",
      configured: true,
      error: error instanceof Error ? error.message : "Falha na Square Cloud",
      apps: [],
    };
  }
}

export async function getSquareLogs(appId: string) {
  const token = process.env.SQUARECLOUD_API_KEY;
  if (!token) throw new Error("SQUARECLOUD_API_KEY não configurada");
  const data = await fetchJson<{ status: string; response?: { logs?: string } }>(
    `${BASE}/apps/${encodeURIComponent(appId)}/logs`,
    { headers: { Authorization: token } },
  );
  return data.response?.logs ?? "Sem logs disponíveis.";
}

export async function squareAction(appId: string, action: "start" | "stop" | "restart") {
  const token = process.env.SQUARECLOUD_API_KEY;
  if (!token) throw new Error("SQUARECLOUD_API_KEY não configurada");
  return fetchJson(`${BASE}/apps/${encodeURIComponent(appId)}/${action}`, {
    method: "POST",
    headers: { Authorization: token },
  });
}

export function squareRealtimeUrl(appId: string) {
  return `${BASE}/apps/${encodeURIComponent(appId)}/realtime`;
}


export async function getSquareAppDetails(appId: string): Promise<Partial<HostingApp>> {
  const token = process.env.SQUARECLOUD_API_KEY;
  if (!token) throw new Error("SQUARECLOUD_API_KEY não configurada");
  const data = await fetchJson<SquareAppStatusResponse>(
    `${BASE}/apps/${encodeURIComponent(appId)}/status`,
    { headers: { Authorization: token } },
  );
  const status = data.response;
  if (!status) return {};
  const running = Boolean(status.running);
  return {
    status: running ? "online" : "offline",
    cpu: status.cpu,
    ram: status.ram,
    storage: status.storage,
    network: status.network?.now || status.network?.total,
    uptime: status.uptime,
    actions: running ? ["stop", "restart"] : ["start"],
  };
}
