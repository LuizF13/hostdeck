import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require(path.resolve("package.json"));
const releaseDir = path.resolve("release", pkg.version);
const source = path.join(releaseDir, `HostDeck-Setup-${pkg.version}-x64.exe`);
const latestDir = path.resolve("release");
const latest = path.join(latestDir, "HostDeck-Setup-LATEST.exe");
const info = path.join(latestDir, "INSTALADOR-ATUAL.txt");

if (process.platform !== "win32") {
  console.log("Finalização do instalador Windows ignorada fora do Windows.");
  process.exit(0);
}
if (!fs.existsSync(source)) throw new Error(`Instalador não encontrado: ${source}`);
fs.mkdirSync(latestDir, { recursive: true });
try { fs.rmSync(latest, { force: true }); } catch {}
fs.copyFileSync(source, latest);
fs.writeFileSync(info, [
  `HostDeck ${pkg.version}`,
  "",
  "Instalador atual:",
  latest,
  "",
  "Use sempre HostDeck-Setup-LATEST.exe para evitar abrir builds antigos.",
].join("\r\n"), "utf8");
console.log(`Instalador atual copiado para: ${latest}`);
