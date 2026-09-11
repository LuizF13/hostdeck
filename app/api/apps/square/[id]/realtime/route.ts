import { squareRealtimeUrl } from "@/lib/providers/square";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const token = process.env.SQUARECLOUD_API_KEY;
  if (!token) return new Response("SQUARECLOUD_API_KEY não configurada", { status: 500 });

  const { id } = await context.params;
  const upstream = await fetch(squareRealtimeUrl(id), {
    headers: { Authorization: token, Accept: "text/event-stream" },
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text(), { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
