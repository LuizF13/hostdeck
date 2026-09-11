import { NextRequest, NextResponse } from "next/server";
import { analyzeInfrastructure, analyzeRecovery, geminiConfigured } from "@/lib/gemini";
import type { HostingApp } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!geminiConfigured()) {
    return NextResponse.json({ error: "Gemini ainda não está configurado. Adicione sua GEMINI_API_KEY nas Credenciais." }, { status: 503 });
  }

  try {
    const body = await request.json();
    const snapshot = body?.snapshot || body || {};
    const apps = Array.isArray(snapshot.apps) ? snapshot.apps as HostingApp[] : [];
    const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];
    const events = Array.isArray(body?.events) ? body.events : [];

    if (body?.mode === "recovery") {
      const app = (body?.app || apps[0]) as HostingApp | undefined;
      if (!app) return NextResponse.json({ error: "Aplicação ausente para análise de recuperação." }, { status: 400 });
      const decision = await analyzeRecovery({
        app,
        previousStatus: body?.previousStatus ?? body?.event?.before ?? null,
        currentStatus: body?.currentStatus ?? body?.event?.after ?? app.status,
        providers,
        event: body?.event || events[0] || {},
      });
      return NextResponse.json(decision);
    }

    const insight = await analyzeInfrastructure({
      mode: body?.mode === "changes" ? "changes" : "briefing",
      apps,
      providers,
      events,
    });
    return NextResponse.json(insight);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao analisar a infraestrutura com Gemini." }, { status: 500 });
  }
}
