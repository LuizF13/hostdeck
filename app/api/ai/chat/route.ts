import { NextRequest, NextResponse } from "next/server";
import { chatWithGemini, geminiConfigured } from "@/lib/gemini";
import type { HostingApp } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!geminiConfigured()) return NextResponse.json({ error: "Configure a GEMINI_API_KEY para usar o chat." }, { status: 503 });
  try {
    const body = await request.json();
    const snapshot = body?.snapshot || {};
    const messages = Array.isArray(body?.messages) ? body.messages.filter((item: unknown) => {
      if (!item || typeof item !== "object") return false;
      const value = item as Record<string, unknown>;
      return (value.role === "user" || value.role === "assistant") && typeof value.content === "string";
    }) : [];
    const result = await chatWithGemini({
      messages,
      apps: Array.isArray(snapshot.apps) ? snapshot.apps as HostingApp[] : [],
      providers: Array.isArray(snapshot.providers) ? snapshot.providers : [],
      alerts: Array.isArray(body?.alerts) ? body.alerts : [],
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao conversar com o Gemini." }, { status: 500 });
  }
}
