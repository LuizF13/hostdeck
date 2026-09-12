import type { AppAction, HostingApp, Provider, ProviderResult } from "@/lib/types";
import { listSquareApps, getSquareAppDetails, getSquareLogs, squareAction } from "@/lib/providers/square";
import { listVercelApps, getVercelAppDetails, getVercelLogs, vercelAction } from "@/lib/providers/vercel";
import { listRenderApps, getRenderAppDetails } from "@/lib/providers/render";
import { listNetlifyApps, getNetlifyAppDetails } from "@/lib/providers/netlify";
import { listCloudflareApps, getCloudflareAppDetails } from "@/lib/providers/cloudflare";
import { listDigitalOceanApps, getDigitalOceanAppDetails } from "@/lib/providers/digitalocean";
import { listHerokuApps, getHerokuAppDetails } from "@/lib/providers/heroku";
import { listDiscloudApps, getDiscloudAppDetails, getDiscloudLogs, discloudAction } from "@/lib/providers/discloud";
import { listNextcloudApps, getNextcloudAppDetails } from "@/lib/providers/nextcloud";

export async function listAllProviders(): Promise<ProviderResult[]> {
  return Promise.all([
    listSquareApps(),
    listVercelApps(),
    listRenderApps(),
    listNetlifyApps(),
    listCloudflareApps(),
    listDigitalOceanApps(),
    listHerokuApps(),
    listDiscloudApps(),
    listNextcloudApps(),
  ]);
}

export async function getProviderAppDetails(provider: Provider, id: string): Promise<Partial<HostingApp>> {
  if (provider === "square") return getSquareAppDetails(id);
  if (provider === "vercel") return getVercelAppDetails(id);
  if (provider === "render") return getRenderAppDetails(id);
  if (provider === "netlify") return getNetlifyAppDetails(id);
  if (provider === "cloudflare") return getCloudflareAppDetails(id);
  if (provider === "digitalocean") return getDigitalOceanAppDetails(id);
  if (provider === "heroku") return getHerokuAppDetails(id);
  if (provider === "discloud") return getDiscloudAppDetails(id);
  if (provider === "nextcloud") return getNextcloudAppDetails(id);
  return {};
}

export async function getProviderLogs(provider: Provider, id: string): Promise<{ logs: string; liveSupported: boolean }> {
  if (provider === "square") return { logs: await getSquareLogs(id), liveSupported: true };
  if (provider === "vercel") return { logs: await getVercelLogs(id), liveSupported: false };
  if (provider === "discloud") return { logs: await getDiscloudLogs(id), liveSupported: false };
  if (provider === "nextcloud") return { logs: "Nextcloud é um workspace de arquivos WebDAV; não possui logs de runtime de aplicação.", liveSupported: false };
  return { logs: `Logs detalhados ainda não são expostos por este conector do HostDeck para ${provider}. Use o link da aplicação ou o painel do provedor.`, liveSupported: false };
}

export async function runProviderAction(provider: Provider, id: string, action: AppAction) {
  if (provider === "square" && ["start", "stop", "restart"].includes(action)) return squareAction(id, action as "start" | "stop" | "restart");
  if (provider === "vercel" && ["pause", "resume"].includes(action)) return vercelAction(id, action as "pause" | "resume");
  if (provider === "discloud" && ["start", "stop", "restart"].includes(action)) return discloudAction(id, action as "start" | "stop" | "restart");
  throw new Error("Ação não suportada por este plugin");
}
