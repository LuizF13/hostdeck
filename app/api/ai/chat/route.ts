import { NextRequest, NextResponse } from "next/server";
import { chatWithGemini, geminiConfigured, streamChatWithGemini } from "@/lib/gemini";
import type { HostingApp } from "@/lib/types";

export const dynamic = "force-dynamic";

function normalizeBody(body: any) {
  const snapshot = body?.snapshot || {};
  const messages = Array.isArray(body?.messages) ? body.messages.filter((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return (value.role === "user" || value.role === "assistant") && typeof value.content === "string";
  }) : [];
  return {
    messages,
    apps: Array.isArray(snapshot.apps) ? snapshot.apps as HostingApp[] : [],
    providers: Array.isArray(snapshot.providers) ? snapshot.providers : [],
    alerts: Array.isArray(body?.alerts) ? body.alerts : [],
  };
}

function textFromGeminiChunk(value: any) {
  return value?.candidates?.[0]?.content?.parts?.map((part: any) => typeof part?.text === "string" ? part.text : "").join("") || "";
}

export async function POST(request: NextRequest) {
  if (!geminiConfigured()) return NextResponse.json({ error: "Configure a GEMINI_API_KEY para usar o chat." }, { status: 503 });
  try {
    const input = normalizeBody(await request.json());
    const wantsStream = request.nextUrl.searchParams.get("stream") === "1";
    if (!wantsStream) return NextResponse.json(await chatWithGemini(input));

    const { response: upstream, model } = await streamChatWithGemini(input);
    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (payload: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() || "";
            for (const block of blocks) {
              for (const line of block.split(/\r?\n/)) {
                if (!line.startsWith("data:")) continue;
                const raw = line.slice(5).trim();
                if (!raw || raw === "[DONE]") continue;
                try {
                  const text = textFromGeminiChunk(JSON.parse(raw));
                  if (text) emit({ type: "delta", text });
                } catch {}
              }
            }
          }
          emit({ type: "done", model });
        } catch (error) {
          emit({ type: "error", error: error instanceof Error ? error.message : "Falha no stream do Gemini." });
        } finally {
          controller.close();
          reader.releaseLock();
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao conversar com o Gemini." }, { status: 500 });
  }
}
