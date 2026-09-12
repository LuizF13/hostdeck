import { fetchJson, ensureHttpUrl } from "@/lib/http";
import type { HostingApp, ProviderResult } from "@/lib/types";

const BASE = "https://api.cloudflare.com/client/v4";

type CFDeployment = { id?: string; url?: string; environment?: string; created_on?: string; latest_stage?: { status?: string; name?: string }; deployment_trigger?: { metadata?: { branch?: string; commit_hash?: string } } };
type CFProject = { id?: string; name: string; subdomain?: string; domains?: string[]; created_on?: string; canonical_deployment?: CFDeployment; latest_deployment?: CFDeployment; production_branch?: string };
type CFWorker = { id?: string; created_on?: string; modified_on?: string; compatibility_date?: string; compatibility_flags?: string[]; usage_model?: string; routes?: Array<{ pattern?: string }> };
type CFWorkerDeployment = { id?: string; created_on?: string; source?: string; strategy?: string };
type CFResponse<T> = { success: boolean; errors?: Array<{ code?: number; message?: string }>; result: T };
type CFWorkerDeploymentsResult = { deployments?: CFWorkerDeployment[] };
type CFAccountSubdomain = { subdomain?: string };
type CFScriptSubdomain = { enabled?: boolean; previews_enabled?: boolean };

function auth() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN não configurado");
  if (!account) throw new Error("CLOUDFLARE_ACCOUNT_ID não configurado");
  return { token, account };
}

function headers(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function requireSuccess<T>(data: CFResponse<T>, fallback: string) {
  if (!data.success) throw new Error(data.errors?.map((item) => item.message).filter(Boolean).join("; ") || fallback);
  return data.result;
}

function pageStatus(project: CFProject): HostingApp["status"] {
  const deployment = project.canonical_deployment || project.latest_deployment;
  const state = deployment?.latest_stage?.status || "";
  if (["success", "ready"].includes(state)) return "online";
  if (["active", "queued", "building", "running"].includes(state)) return "building";
  if (["failure", "failed", "error"].includes(state)) return "error";
  return deployment?.url || project.subdomain ? "online" : "unknown";
}

function pageUrl(project: CFProject) {
  const deployment = project.canonical_deployment || project.latest_deployment;
  return ensureHttpUrl(project.domains?.[0] || project.subdomain || deployment?.url);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Falha na Cloudflare");
}

function workerPermissionMessage(error: unknown) {
  const raw = errorText(error);
  if (/401|403|authentication|authorization|permission|10000|9109/i.test(raw)) {
    return "Workers não puderam ser consultados. No token da Cloudflare, adicione Account → Workers Scripts → Read para esta conta.";
  }
  return `Workers: ${raw}`;
}

async function listPages(token: string, account: string): Promise<HostingApp[]> {
  const data = await fetchJson<CFResponse<CFProject[]>>(
    `${BASE}/accounts/${encodeURIComponent(account)}/pages/projects?per_page=100`,
    { headers: headers(token) },
  );
  const projects = requireSuccess(data, "Cloudflare Pages retornou success=false") ?? [];
  return projects.map((project) => {
    const deployment = project.canonical_deployment || project.latest_deployment;
    return {
      id: `pages:${project.name}`,
      provider: "cloudflare",
      name: project.name,
      status: pageStatus(project),
      url: pageUrl(project),
      createdAt: project.created_on,
      updatedAt: deployment?.created_on ? new Date(deployment.created_on).getTime() : undefined,
      latestDeploymentId: deployment?.id,
      latestDeploymentState: deployment?.latest_stage?.status,
      language: project.production_branch ? `Pages · branch ${project.production_branch}` : "Cloudflare Pages",
      description: "Projeto Cloudflare Pages",
      metadata: { cloudflareKind: "pages" },
      actions: [],
    } satisfies HostingApp;
  });
}

async function getAccountWorkersSubdomain(token: string, account: string) {
  try {
    const data = await fetchJson<CFResponse<CFAccountSubdomain>>(
      `${BASE}/accounts/${encodeURIComponent(account)}/workers/subdomain`,
      { headers: headers(token) },
    );
    return requireSuccess(data, "Cloudflare Workers subdomain retornou success=false")?.subdomain;
  } catch {
    return undefined;
  }
}

async function listWorkers(token: string, account: string): Promise<HostingApp[]> {
  const [data, subdomain] = await Promise.all([
    fetchJson<CFResponse<CFWorker[]>>(
      `${BASE}/accounts/${encodeURIComponent(account)}/workers/scripts`,
      { headers: headers(token) },
    ),
    getAccountWorkersSubdomain(token, account),
  ]);
  const workers = requireSuccess(data, "Cloudflare Workers retornou success=false") ?? [];
  return workers.flatMap((worker) => {
    const name = worker.id?.trim();
    if (!name) return [];
    const routePattern = worker.routes?.map((route) => route.pattern).find((pattern) => pattern && !pattern.startsWith("*."));
    const routeHost = routePattern?.replace(/^https?:\/\//i, "").split("/")[0]?.replace(/\*+$/g, "");
    const routeUrl = routeHost && !routeHost.includes("*") ? `https://${routeHost}` : undefined;
    return [{
      id: `worker:${name}`,
      provider: "cloudflare",
      name,
      status: "online",
      url: routeUrl || (subdomain ? `https://${name}.${subdomain}.workers.dev` : undefined),
      createdAt: worker.created_on,
      updatedAt: worker.modified_on ? new Date(worker.modified_on).getTime() : undefined,
      latestDeploymentState: "deployed",
      language: worker.compatibility_date ? `Workers · compat ${worker.compatibility_date}` : "Cloudflare Workers",
      description: "Cloudflare Worker",
      metadata: { cloudflareKind: "worker" },
      actions: [],
    } satisfies HostingApp];
  });
}

export async function listCloudflareApps(): Promise<ProviderResult> {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    return { provider: "cloudflare", configured: false, apps: [] };
  }

  const { token, account } = auth();
  const [pagesResult, workersResult] = await Promise.allSettled([
    listPages(token, account),
    listWorkers(token, account),
  ]);

  const apps: HostingApp[] = [];
  const errors: string[] = [];

  if (pagesResult.status === "fulfilled") apps.push(...pagesResult.value);
  else errors.push(`Pages: ${errorText(pagesResult.reason)}`);

  if (workersResult.status === "fulfilled") apps.push(...workersResult.value);
  else errors.push(workerPermissionMessage(workersResult.reason));

  if (!apps.length && errors.length) {
    return { provider: "cloudflare", configured: true, apps: [], error: errors.join(" | ") };
  }

  return { provider: "cloudflare", configured: true, apps };
}

async function getPageDetails(name: string, token: string, account: string): Promise<Partial<HostingApp>> {
  const data = await fetchJson<CFResponse<CFProject>>(
    `${BASE}/accounts/${encodeURIComponent(account)}/pages/projects/${encodeURIComponent(name)}`,
    { headers: headers(token) },
  );
  const project = requireSuccess(data, "Cloudflare Pages retornou success=false");
  const deployment = project.canonical_deployment || project.latest_deployment;
  return {
    status: pageStatus(project),
    url: pageUrl(project),
    latestDeploymentId: deployment?.id,
    latestDeploymentState: deployment?.latest_stage?.status,
    updatedAt: deployment?.created_on ? new Date(deployment.created_on).getTime() : undefined,
    language: project.production_branch ? `Pages · branch ${project.production_branch}` : "Cloudflare Pages",
    metadata: { cloudflareKind: "pages" },
    actions: [],
  };
}

async function getWorkerDetails(name: string, token: string, account: string): Promise<Partial<HostingApp>> {
  const [deploymentsData, accountSubdomain, scriptSubdomainData] = await Promise.all([
    fetchJson<CFResponse<CFWorkerDeploymentsResult>>(
      `${BASE}/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(name)}/deployments`,
      { headers: headers(token) },
    ),
    getAccountWorkersSubdomain(token, account),
    fetchJson<CFResponse<CFScriptSubdomain>>(
      `${BASE}/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(name)}/subdomain`,
      { headers: headers(token) },
    ).catch(() => null),
  ]);

  const deployments = requireSuccess(deploymentsData, "Cloudflare Workers deployments retornou success=false")?.deployments ?? [];
  const latest = deployments[0];
  const enabled = scriptSubdomainData?.success ? scriptSubdomainData.result?.enabled !== false : true;
  const workersDevUrl = enabled && accountSubdomain ? `https://${name}.${accountSubdomain}.workers.dev` : undefined;
  return {
    status: latest ? "online" : "unknown",
    ...(workersDevUrl ? { url: workersDevUrl } : {}),
    latestDeploymentId: latest?.id,
    latestDeploymentState: "deployed",
    updatedAt: latest?.created_on ? new Date(latest.created_on).getTime() : undefined,
    language: "Cloudflare Workers",
    metadata: { cloudflareKind: "worker", workersDevEnabled: enabled },
    actions: [],
  };
}

export async function getCloudflareAppDetails(id: string): Promise<Partial<HostingApp>> {
  const { token, account } = auth();
  if (id.startsWith("worker:")) return getWorkerDetails(id.slice("worker:".length), token, account);
  if (id.startsWith("pages:")) return getPageDetails(id.slice("pages:".length), token, account);
  // Compatibilidade com IDs antigos, que eram apenas o nome do projeto Pages.
  return getPageDetails(id, token, account);
}
