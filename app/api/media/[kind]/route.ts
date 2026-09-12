import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;
const KINDS = new Set(["app", "banner"]);
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};
const EXT_MIMES: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXTENSIONS).map(([mime, ext]) => [ext, mime]),
);

type MediaKind = "app" | "banner";

function isKind(value: string): value is MediaKind {
  return KINDS.has(value);
}

function mediaRoot() {
  return process.env.HOSTDECK_MEDIA_DIR || path.join(process.cwd(), ".hostdeck-media");
}

async function findStored(kind: MediaKind) {
  const root = mediaRoot();
  for (const ext of Object.values(MIME_EXTENSIONS)) {
    const file = path.join(root, `${kind}.${ext}`);
    try {
      const stat = await fs.stat(file);
      if (stat.isFile()) return { file, ext, stat };
    } catch {}
  }
  return null;
}

function fallbackSvg(kind: MediaKind) {
  if (kind === "banner") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="520" viewBox="0 0 1600 520"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset=".5" stop-color="#1e293b"/><stop offset="1" stop-color="#0f172a"/></linearGradient><radialGradient id="r" cx="75%" cy="20%" r="70%"><stop stop-color="#38bdf8" stop-opacity=".24"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient></defs><rect width="1600" height="520" fill="url(#g)"/><rect width="1600" height="520" fill="url(#r)"/><g fill="none" stroke="#fff" stroke-opacity=".06"><path d="M0 390C280 250 430 510 730 330S1240 190 1600 340"/><path d="M0 430C310 280 520 530 820 350S1320 220 1600 370"/></g></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2563eb"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><path d="M154 151h76v70h52v-70h76v210h-76v-76h-52v76h-76z" fill="#fff"/></svg>`;
}

function noStore(contentType: string) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
  };
}

export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind: rawKind } = await context.params;
  if (!isKind(rawKind)) return new Response("Not found", { status: 404 });

  const stored = await findStored(rawKind);
  if (!stored) {
    return new Response(fallbackSvg(rawKind), { headers: noStore("image/svg+xml; charset=utf-8") });
  }

  const bytes = await fs.readFile(stored.file);
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...noStore(EXT_MIMES[stored.ext] || "application/octet-stream"),
      "Last-Modified": stored.stat.mtime.toUTCString(),
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind: rawKind } = await context.params;
  if (!isKind(rawKind)) return Response.json({ error: "Tipo de mídia inválido." }, { status: 404 });

  try {
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) return Response.json({ error: "Selecione um arquivo de imagem." }, { status: 400 });

    const ext = MIME_EXTENSIONS[value.type];
    if (!ext) {
      return Response.json({ error: "Formato não suportado. Use PNG, JPG, WebP, GIF ou AVIF." }, { status: 415 });
    }
    if (!value.size || value.size > MAX_BYTES) {
      return Response.json({ error: "A imagem deve ter no máximo 25 MB." }, { status: 413 });
    }

    const bytes = Buffer.from(await value.arrayBuffer());
    const root = mediaRoot();
    await fs.mkdir(root, { recursive: true });

    for (const oldExt of Object.values(MIME_EXTENSIONS)) {
      await fs.rm(path.join(root, `${rawKind}.${oldExt}`), { force: true }).catch(() => {});
    }

    const finalPath = path.join(root, `${rawKind}.${ext}`);
    const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, bytes, { mode: 0o600 });
    await fs.rename(tempPath, finalPath);

    return Response.json({ ok: true, kind: rawKind, contentType: value.type, size: value.size, updatedAt: Date.now() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao salvar imagem." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind: rawKind } = await context.params;
  if (!isKind(rawKind)) return Response.json({ error: "Tipo de mídia inválido." }, { status: 404 });

  const root = mediaRoot();
  for (const ext of Object.values(MIME_EXTENSIONS)) {
    await fs.rm(path.join(root, `${rawKind}.${ext}`), { force: true }).catch(() => {});
  }
  return Response.json({ ok: true, kind: rawKind });
}
