import { NextRequest, NextResponse } from "next/server";
import type { Provider } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DISCLOUD_BASE = "https://api.discloud.app/v2";
const SQUARE_BASE = "https://api.squarecloud.app/v2";
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const SQUARE_FILE_BYTES = 10 * 1024 * 1024;

type WorkspaceProvider = Extract<Provider, "square" | "discloud" | "nextcloud">;

function isWorkspaceProvider(value: string): value is WorkspaceProvider {
  return value === "square" || value === "discloud" || value === "nextcloud";
}
function cleanPath(value: string | null | undefined) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
}
function withLeadingSlash(value: string) {
  const clean = cleanPath(value);
  return clean ? `/${clean}` : "/";
}
async function responseJson(response: Response) {
  const text = await response.text();
  let data: any = text;
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) throw new Error(`${response.status} ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function squareHeaders() {
  const token = process.env.SQUARECLOUD_API_KEY?.trim();
  if (!token) throw new Error("SQUARECLOUD_API_KEY não configurada");
  return { Authorization: token };
}
async function squareJson(response: Response) {
  const data = await responseJson(response);
  if (data?.status && data.status !== "success") throw new Error(data?.message || data?.code || "Falha na Square Cloud");
  return data;
}
async function listSquare(id: string, path: string) {
  const url = new URL(`${SQUARE_BASE}/apps/${encodeURIComponent(id)}/files`);
  url.searchParams.set("path", withLeadingSlash(path));
  const data = await squareJson(await fetch(url, { headers: squareHeaders(), cache: "no-store" }));
  const entries = (Array.isArray(data?.response) ? data.response : []).map((item: any) => ({
    name: String(item?.name || ""),
    path: cleanPath([path, String(item?.name || "")].filter(Boolean).join("/")),
    type: item?.type === "directory" ? "directory" : "file",
    size: Number(item?.size || 0) || undefined,
    modified: item?.lastModified ? new Date(Number(item.lastModified)).toISOString() : undefined,
  })).filter((entry: any) => entry.name);
  return { cwd: path, entries, capabilities: { read: true, write: true, upload: true, deployZip: true } };
}
async function openSquare(id: string, path: string) {
  const url = new URL(`${SQUARE_BASE}/apps/${encodeURIComponent(id)}/files/content`);
  url.searchParams.set("path", withLeadingSlash(path));
  const data = await squareJson(await fetch(url, { headers: squareHeaders(), cache: "no-store" }));
  const bytes = Array.isArray(data?.response?.data) ? data.response.data : [];
  if (bytes.length > MAX_TEXT_BYTES) throw new Error("Arquivo grande demais para abrir no editor (máximo 5 MB).");
  return { path, content: Buffer.from(bytes).toString("utf8") };
}
async function saveSquare(id: string, path: string, content: string) {
  if (Buffer.byteLength(content, "utf8") > SQUARE_FILE_BYTES) throw new Error("A Square Cloud aceita no máximo 10 MB por gravação no File Manager.");
  const response = await fetch(`${SQUARE_BASE}/apps/${encodeURIComponent(id)}/files`, {
    method: "PUT",
    headers: { ...squareHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ path: withLeadingSlash(path), content }),
  });
  return squareJson(response);
}
async function uploadSquareFile(id: string, cwd: string, file: File) {
  if (file.size > SQUARE_FILE_BYTES) throw new Error("Upload individual na Square Cloud aceita no máximo 10 MB. Para projetos maiores, use Deploy ZIP.");
  const target = cleanPath([cwd, file.name].filter(Boolean).join("/"));
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const response = await fetch(`${SQUARE_BASE}/apps/${encodeURIComponent(id)}/files`, {
    method: "PUT",
    headers: { ...squareHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ path: withLeadingSlash(target), content: bytes }),
  });
  await squareJson(response);
  return { ok: true, path: target };
}
async function deploySquareZip(id: string, file: File) {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("O deploy completo da Square Cloud exige um arquivo .ZIP.");
  const form = new FormData();
  form.set("file", new File([await file.arrayBuffer()], file.name, { type: file.type || "application/zip" }));
  const response = await fetch(`${SQUARE_BASE}/apps/${encodeURIComponent(id)}/commit`, {
    method: "POST",
    headers: squareHeaders(),
    body: form,
  });
  return squareJson(response);
}

function discloudHeaders() {
  const token = process.env.DISCLOUD_API_TOKEN?.trim();
  if (!token) throw new Error("DISCLOUD_API_TOKEN não configurado");
  return { "api-token": token };
}
function findArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["files", "items", "entries", "explorer", "data", "result"]) if (Array.isArray(value[key])) return value[key];
  return [];
}
function normalizeDiscloudEntries(raw: any, cwd: string) {
  return findArray(raw).map((item: any) => {
    if (typeof item === "string") return { name: item.split("/").pop() || item, path: cleanPath(item), type: "file" };
    const name = String(item.name || item.fileName || item.basename || String(item.path || "").split("/").pop() || "");
    const entryPath = cleanPath(item.path || item.cPath || (cwd ? `${cwd}/${name}` : name));
    const rawType = String(item.type || item.typeFile || item.kind || "").toLowerCase();
    const type = item.isDirectory || item.directory || /dir|folder|directory/.test(rawType) ? "directory" : "file";
    return { name, path: entryPath, type, size: Number(item.size || item.bytes || 0) || undefined, modified: item.modified || item.updatedAt || item.mtime || undefined };
  }).filter((entry: any) => entry.name);
}
function discloudContent(raw: any) {
  const found = [raw?.fileContent, raw?.content, raw?.data?.fileContent, raw?.data?.content, raw?.result?.fileContent, raw?.result?.content].find((value) => typeof value === "string");
  if (typeof found === "string") return found;
  if (typeof raw === "string") return raw;
  return JSON.stringify(raw, null, 2);
}
async function listDiscloud(id: string, path: string) {
  const url = new URL(`${DISCLOUD_BASE}/app/${encodeURIComponent(id)}/explorer`);
  if (path) url.searchParams.set("cPath", path);
  const data = await responseJson(await fetch(url, { headers: discloudHeaders(), cache: "no-store" }));
  return { cwd: path, entries: normalizeDiscloudEntries(data, path), capabilities: { read: true, write: true, upload: false, deployZip: true } };
}
async function openDiscloud(id: string, path: string) {
  const url = new URL(`${DISCLOUD_BASE}/app/${encodeURIComponent(id)}/explorer/open`);
  url.searchParams.set("cPath", path);
  return { path, content: discloudContent(await responseJson(await fetch(url, { headers: discloudHeaders(), cache: "no-store" }))) };
}
async function saveDiscloud(id: string, path: string, content: string) {
  return responseJson(await fetch(`${DISCLOUD_BASE}/app/${encodeURIComponent(id)}/explorer/edit`, {
    method: "PUT",
    headers: { ...discloudHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ cPath: path, fileContent: content }),
  }));
}
async function deployDiscloudZip(id: string, file: File) {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("A Discloud exige arquivo .ZIP para commit.");
  const upstream = new FormData();
  upstream.set("file", new File([await file.arrayBuffer()], file.name, { type: file.type || "application/zip" }));
  return responseJson(await fetch(`${DISCLOUD_BASE}/app/${encodeURIComponent(id)}/commit`, {
    method: "PUT",
    headers: discloudHeaders(),
    body: upstream,
  }));
}

function nextcloudConfig() {
  const serverUrl = process.env.NEXTCLOUD_URL?.trim().replace(/\/+$/, "");
  const username = process.env.NEXTCLOUD_USERNAME?.trim();
  const password = process.env.NEXTCLOUD_APP_PASSWORD?.trim();
  const rootPath = cleanPath(process.env.NEXTCLOUD_ROOT_PATH);
  if (!serverUrl || !username || !password) throw new Error("Nextcloud não configurado");
  return { serverUrl, username, password, rootPath };
}
function basic(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}
function encodePath(value: string) {
  return cleanPath(value).split("/").filter(Boolean).map(encodeURIComponent).join("/");
}
function nextcloudUrl(relative = "") {
  const { serverUrl, username, rootPath } = nextcloudConfig();
  const full = [rootPath, cleanPath(relative)].filter(Boolean).join("/");
  return `${serverUrl}/remote.php/dav/files/${encodeURIComponent(username)}${full ? `/${encodePath(full)}` : ""}`;
}
function xmlText(block: string, tag: string) {
  const match = block.match(new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, "i"));
  return match?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
}
function decodeXml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function parseNextcloudEntries(xml: string, cwd: string) {
  const blocks = xml.match(/<(?:[^:>]+:)?response\b[\s\S]*?<\/(?:[^:>]+:)?response>/gi) || [];
  const requested = cleanPath(cwd);
  const entries: any[] = [];
  for (const block of blocks) {
    const hrefRaw = xmlText(block, "href");
    if (!hrefRaw) continue;
    let href = "";
    try { href = decodeURIComponent(decodeXml(hrefRaw)); } catch { href = decodeXml(hrefRaw); }
    let pathname = href;
    try { if (/^https?:\/\//i.test(href)) pathname = new URL(href).pathname; } catch {}
    const trimmed = pathname.replace(/\/+$/, "");
    const name = trimmed.split("/").pop() || "";
    if (!name) continue;
    const isDir = /<(?:[^:>]+:)?collection\b/i.test(block);
    const rootUrlPath = new URL(nextcloudUrl(requested)).pathname.replace(/\/+$/, "");
    if (trimmed === rootUrlPath) continue;
    entries.push({
      name,
      path: cleanPath([requested, name].filter(Boolean).join("/")),
      type: isDir ? "directory" : "file",
      size: Number(xmlText(block, "getcontentlength")) || undefined,
      modified: xmlText(block, "getlastmodified") || undefined,
    });
  }
  return entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1);
}
async function listNextcloud(path: string) {
  const { username, password } = nextcloudConfig();
  const response = await fetch(nextcloudUrl(path), {
    method: "PROPFIND",
    headers: { Authorization: basic(username, password), Depth: "1", "Content-Type": "application/xml" },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>',
    cache: "no-store",
  });
  const xml = await response.text();
  if (!response.ok && response.status !== 207) throw new Error(`Nextcloud WebDAV HTTP ${response.status}: ${xml.slice(0, 500)}`);
  return { cwd: path, entries: parseNextcloudEntries(xml, path), capabilities: { read: true, write: true, upload: true, deployZip: false } };
}
async function openNextcloud(path: string) {
  const { username, password } = nextcloudConfig();
  const response = await fetch(nextcloudUrl(path), { headers: { Authorization: basic(username, password) }, cache: "no-store" });
  if (!response.ok) throw new Error(`Nextcloud HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_TEXT_BYTES) throw new Error("Arquivo grande demais para abrir no editor (máximo 5 MB).");
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !/^text\//i.test(contentType) && !/json|javascript|xml|yaml|toml|svg/i.test(contentType)) throw new Error("Este arquivo parece binário e não pode ser editado como texto.");
  return { path, content: await response.text() };
}
async function saveNextcloud(path: string, content: string) {
  const { username, password } = nextcloudConfig();
  const response = await fetch(nextcloudUrl(path), {
    method: "PUT",
    headers: { Authorization: basic(username, password), "Content-Type": "text/plain; charset=utf-8", "X-NC-WebDAV-AutoMkcol": "1" },
    body: content,
  });
  if (!response.ok) throw new Error(`Nextcloud HTTP ${response.status}`);
  return { ok: true };
}
async function uploadNextcloud(path: string, file: File) {
  const target = cleanPath([path, file.name].filter(Boolean).join("/"));
  const { username, password } = nextcloudConfig();
  const response = await fetch(nextcloudUrl(target), {
    method: "PUT",
    headers: { Authorization: basic(username, password), "Content-Type": file.type || "application/octet-stream", "X-NC-WebDAV-AutoMkcol": "1" },
    body: new Uint8Array(await file.arrayBuffer()),
  });
  if (!response.ok) throw new Error(`Nextcloud HTTP ${response.status}`);
  return { ok: true, path: target };
}

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string; id: string }> }) {
  try {
    const { provider, id } = await context.params;
    if (!isWorkspaceProvider(provider)) return NextResponse.json({ error: "Workspace não suportado por este provedor." }, { status: 400 });
    const action = request.nextUrl.searchParams.get("action") || "list";
    const path = cleanPath(request.nextUrl.searchParams.get("path"));
    if (action === "list") {
      const result = provider === "square" ? await listSquare(id, path) : provider === "discloud" ? await listDiscloud(id, path) : await listNextcloud(path);
      return NextResponse.json(result);
    }
    if (action === "open") {
      const result = provider === "square" ? await openSquare(id, path) : provider === "discloud" ? await openDiscloud(id, path) : await openNextcloud(path);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha no workspace." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ provider: string; id: string }> }) {
  try {
    const { provider, id } = await context.params;
    if (!isWorkspaceProvider(provider)) return NextResponse.json({ error: "Workspace não suportado." }, { status: 400 });
    const body = await request.json();
    const path = cleanPath(body?.path);
    const content = typeof body?.content === "string" ? body.content : "";
    if (!path) return NextResponse.json({ error: "Caminho ausente." }, { status: 400 });
    if (provider === "square") await saveSquare(id, path, content);
    else if (provider === "discloud") await saveDiscloud(id, path, content);
    else await saveNextcloud(path, content);
    return NextResponse.json({ ok: true, path });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao salvar arquivo." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string; id: string }> }) {
  try {
    const { provider, id } = await context.params;
    if (!isWorkspaceProvider(provider)) return NextResponse.json({ error: "Upload não suportado." }, { status: 400 });
    const form = await request.formData();
    const file = form.get("file");
    const action = String(form.get("action") || "upload");
    const cwd = cleanPath(String(form.get("path") || ""));
    if (!(file instanceof File)) return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
    if (!file.size || file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Arquivo deve ter no máximo 200 MB." }, { status: 413 });

    if (action === "deploy") {
      if (provider === "square") return NextResponse.json({ ok: true, result: await deploySquareZip(id, file) });
      if (provider === "discloud") return NextResponse.json({ ok: true, result: await deployDiscloudZip(id, file) });
      return NextResponse.json({ error: "Deploy ZIP não é usado por este provedor." }, { status: 400 });
    }

    if (provider === "square") return NextResponse.json(await uploadSquareFile(id, cwd, file));
    if (provider === "nextcloud") return NextResponse.json(await uploadNextcloud(cwd, file));
    return NextResponse.json({ error: "A Discloud usa Deploy ZIP para atualizar a aplicação." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha no upload." }, { status: 500 });
  }
}
