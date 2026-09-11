import { fetchJson, ensureHttpUrl } from "@/lib/http";
import type { HostingApp, ProviderResult } from "@/lib/types";

const BASE = "https://api.vercel.com";

interface VercelProjectsResponse {
  projects?: Array<{
    id: string;
    name: string;
    framework?: string | null;
    paused?: boolean;
    live?: boolean;
    updatedAt?: number;
    createdAt?: number;
    targets?: {
      production?: {
        alias?: string[];
        url?: string;
        id?: string;
        readyState?: string;
      };
    };
  }>;
}

interface VercelDeployment {
  uid?: string;
  id?: string;
  url?: string;
  state?: string;
  readyState?: string;
  created?: number;
}

interface VercelDeploymentsResponse {
  deployments?: VercelDeployment[];
}

function queryWithTeam(params: URLSearchParams) {
  const team = process.env.VERCEL_TEAM_ID;
  if (team) params.set("teamId", team);
  return params;
}

function authHeaders() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error("VERCEL_TOKEN não configurado");
  return { Authorization: `Bearer ${token}` };
}

export async function listVercelApps(): Promise<ProviderResult> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { provider: "vercel", configured: false, apps: [] };

  try {
    const params = queryWithTeam(new URLSearchParams({ limit: "100" }));
    const data = await fetchJson<VercelProjectsResponse>(`${BASE}/v9/projects?${params}`, {
      headers: authHeaders(),
    });

    const apps: HostingApp[] = (data.projects ?? []).map((project) => {
      const production = project.targets?.production;
      const alias = production?.alias?.[0];
      const url = ensureHttpUrl(alias || production?.url);
      const paused = Boolean(project.paused);
      const readyState = production?.readyState;
      const status = paused
        ? "paused"
        : readyState === "READY"
          ? "online"
          : readyState === "BUILDING" || readyState === "QUEUED" || readyState === "INITIALIZING"
            ? "building"
            : project.live === false
              ? "offline"
              : "unknown";

      return {
        id: project.id,
        provider: "vercel",
        name: project.name,
        status,
        url,
        language: project.framework || undefined,
        updatedAt: project.updatedAt,
        createdAt: project.createdAt ? new Date(project.createdAt).toISOString() : undefined,
        latestDeploymentId: production?.id,
        latestDeploymentState: readyState,
        actions: paused ? ["resume"] : ["pause"],
      };
    });

    return { provider: "vercel", configured: true, apps };
  } catch (error) {
    return {
      provider: "vercel",
      configured: true,
      error: error instanceof Error ? error.message : "Falha na Vercel",
      apps: [],
    };
  }
}

export async function getVercelLogs(projectId: string) {
  const listParams = queryWithTeam(
    new URLSearchParams({ projectId, limit: "1" }),
  );
  const deployments = await fetchJson<VercelDeploymentsResponse>(
    `${BASE}/v6/deployments?${listParams}`,
    { headers: authHeaders() },
  );
  const deployment = deployments.deployments?.[0];
  const deploymentId = deployment?.uid || deployment?.id || deployment?.url;
  if (!deploymentId) return "Nenhum deployment encontrado para este projeto.";

  const eventsParams = queryWithTeam(
    new URLSearchParams({ direction: "backward", limit: "250", builds: "1" }),
  );
  const events = await fetchJson<Array<{ type?: string; created?: number; payload?: { text?: string; date?: number; statusCode?: number } }>>(
    `${BASE}/v3/deployments/${encodeURIComponent(deploymentId)}/events?${eventsParams}`,
    { headers: authHeaders() },
  );

  const lines = (events ?? [])
    .slice()
    .reverse()
    .map((event) => {
      const ts = event.payload?.date || event.created;
      const stamp = ts ? new Date(ts).toLocaleTimeString("pt-BR") : "--:--:--";
      const text = event.payload?.text || event.type || "evento";
      return `[${stamp}] ${text}`;
    });

  return lines.length ? lines.join("\n") : "Sem eventos de deployment disponíveis.";
}

export async function vercelAction(projectId: string, action: "pause" | "resume") {
  const params = queryWithTeam(new URLSearchParams());
  const endpointAction = action === "resume" ? "unpause" : "pause";
  return fetchJson(`${BASE}/v1/projects/${encodeURIComponent(projectId)}/${endpointAction}?${params}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
  });
}

export async function getVercelAppDetails(projectId: string): Promise<Partial<HostingApp>> {
  const params = queryWithTeam(new URLSearchParams());
  const project = await fetchJson<{
    id: string;
    name: string;
    paused?: boolean;
    live?: boolean;
    updatedAt?: number;
  }>(`${BASE}/v9/projects/${encodeURIComponent(projectId)}?${params}`, {
    headers: authHeaders(),
  });

  return {
    status: project.paused ? "paused" : "online",
    updatedAt: project.updatedAt,
    actions: project.paused ? ["resume"] : ["pause"],
  };
}
