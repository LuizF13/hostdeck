import { NextResponse } from "next/server";
import { listAllProviders } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const providers = await listAllProviders();
  return NextResponse.json({
    apps: providers.flatMap((provider) => provider.apps),
    providers: providers.map(({ provider, configured, error }) => ({ provider, configured, error })),
    fetchedAt: Date.now(),
  });
}
