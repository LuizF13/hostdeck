import { NextResponse } from "next/server";
import { runProviderAction } from "@/lib/providers";
import { isProvider } from "@/lib/plugins";
import type { AppAction } from "@/lib/types";

export async function POST(request: Request, context: { params: Promise<{ provider: string; id: string }> }) {
  try {
    const { provider, id } = await context.params;
    if (!isProvider(provider)) return NextResponse.json({ error: "Provider inválido" }, { status: 400 });
    const body = (await request.json()) as { action?: AppAction };
    if (!body.action) return NextResponse.json({ error: "Ação ausente" }, { status: 400 });
    await runProviderAction(provider, id, body.action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao executar ação" }, { status: 500 });
  }
}
