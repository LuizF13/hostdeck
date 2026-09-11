import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require(path.resolve("package.json"));
const file = path.resolve("dist", `HostDeck-Setup-${pkg.version}-x64.exe`);

if (!fs.existsSync(file)) {
  console.error(`\nERRO: o instalador oficial nao foi gerado:\n${file}\n`);
  console.error("Nao execute electron.exe, nem arquivos dentro de win-unpacked. O arquivo correto precisa ser HostDeck-Setup-<versao>-x64.exe.");
  process.exit(1);
}

const size = fs.statSync(file).size;
if (size < 10 * 1024 * 1024) {
  console.error(`\nERRO: o instalador parece incompleto (${Math.round(size / 1024 / 1024)} MB):\n${file}\n`);
  process.exit(1);
}

console.log(`\nInstalador Windows validado:\n${file}\n${(size / 1024 / 1024).toFixed(1)} MB\n`);
