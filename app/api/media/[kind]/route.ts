const SOURCES: Record<string, string> = {
  app: "https://cdn.discordapp.com/attachments/1490050434335772756/1547818141055459349/ccb5d59914943deda83358c27de5c0f3.gif?ex=6aa4cd79&is=6aa37bf9&hm=c15a8a7cdfa442a187b1f810ae87432dbcf038c35043c98068b6ab87dcefc706&",
  banner: "https://cdn.discordapp.com/attachments/1490050434335772756/1535031720775254096/download.gif?ex=6aa46db1&is=6aa31c31&hm=2a6e2760395c87119020fe89006ab0ad3551a8003a4037da8998e7c2ecc53c84&",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  const override = kind === "app" ? process.env.HOSTDECK_APP_FALLBACK_URL : kind === "banner" ? process.env.HOSTDECK_BANNER_URL : undefined;
  const source = override || SOURCES[kind];
  if (!source) return new Response("Not found", { status: 404 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const upstream = await fetch(source, { signal: controller.signal, cache: "no-store", headers: { "User-Agent": "HostDeck/1.3" } });
    if (!upstream.ok || !upstream.body) return new Response("Media unavailable", { status: 502 });
    return new Response(upstream.body, { headers: { "Content-Type": upstream.headers.get("content-type") || "image/gif", "Cache-Control": "public, max-age=900" } });
  } catch {
    return new Response("Media unavailable", { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
