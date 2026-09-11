import { NextResponse } from "next/server";
import { getProviderAppDetails } from "@/lib/providers";
import { isProvider } from "@/lib/plugins";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ provider: string; id: string }> }) {
  try {
    const { provider, id } = await context.params;
    if (!isProvider(provider)) return NextResponse.json({ error: "Provider inválido" }, { status: 400 });
    return NextResponse.json({ details: await getProviderAppDetails(provider, id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao buscar detalhes" }, { status: 500 });
  }
}
