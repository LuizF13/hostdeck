import { fetchJson, ensureHttpUrl } from "@/lib/http";
import type { HostingApp, ProviderResult } from "@/lib/types";

const BASE = "https://api.cloudflare.com/client/v4";

type CFDeployment = { id?: string; url?: string; environment?: string; created_on?: string; latest_stage?: { status?: string; name?: string }; deployment_trigger?: { metadata?: { branch?: string; commit_hash?: string } } };
type CFProject = { id?: string; name: string; subdomain?: string; domains?: string[]; created_on?: string; canonical_deployment?: CFDeployment; latest_deployment?: CFDeployment; production_branch?: string };
type CFResponse<T> = { success: boolean; errors?: Array<{ message?: string }>; result: T };

function auth() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN não configurado");
  if (!account) throw new Error("CLOUDFLARE_ACCOUNT_ID não configurado");
  return { token, account };
}

function statusOf(project: CFProject): HostingApp["status"] {
  const deployment = project.canonical_deployment || project.latest_deployment;
  const state = deployment?.latest_stage?.status || "";
  if (["success", "ready"].includes(state)) return "online";
  if (["active", "queued", "building", "running"].includes(state)) return "building";
  if (["failure", "failed", "error"].includes(state)) return "error";
  return deployment?.url || project.subdomain ? "online" : "unknown";
}

function projectUrl(project: CFProject) {
  const deployment = project.canonical_deployment || project.latest_deployment;
  return ensureHttpUrl(project.domains?.[0] || project.subdomain || deployment?.url);
}

export async function listCloudflareApps(): Promise<ProviderResult> {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) return { provider: "cloudflare", configured: false, apps: [] };
  try {
    const { token, account } = auth();
    const data = await fetchJson<CFResponse<CFProject[]>>(`${BASE}/accounts/${encodeURIComponent(account)}/pages/projects?per_page=100`, { headers: { Authorization: `Bearer ${token}` } });
    if (!data.success) throw new Error(data.errors?.map((item) => item.message).filter(Boolean).join("; ") || "Cloudflare retornou success=false");
    const apps: HostingApp[] = (data.result ?? []).map((project) => {
      const deployment = project.canonical_deployment || project.latest_deployment;
      return {
        id: project.name,
        provider: "cloudflare",
        name: project.name,
        status: statusOf(project),
        url: projectUrl(project),
        createdAt: project.created_on,
        updatedAt: deployment?.created_on ? new Date(deployment.created_on).getTime() : undefined,
        latestDeploymentId: deployment?.id,
        latestDeploymentState: deployment?.latest_stage?.status,
        language: project.production_branch ? `branch: ${project.production_branch}` : undefined,
        description: "Projeto Cloudflare Pages",
        actions: [],
      };
    });
    return { provider: "cloudflare", configured: true, apps };
  } catch (error) {
    return { provider: "cloudflare", configured: true, apps: [], error: error instanceof Error ? error.message : "Falha na Cloudflare" };
  }
}

export async function getCloudflareAppDetails(name: string): Promise<Partial<HostingApp>> {
  const { token, account } = auth();
  const data = await fetchJson<CFResponse<CFProject>>(`${BASE}/accounts/${encodeURIComponent(account)}/pages/projects/${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${token}` } });
  const project = data.result;
  const deployment = project.canonical_deployment || project.latest_deployment;
  return { status: statusOf(project), url: projectUrl(project), latestDeploymentId: deployment?.id, latestDeploymentState: deployment?.latest_stage?.status, updatedAt: deployment?.created_on ? new Date(deployment.created_on).getTime() : undefined };
}
