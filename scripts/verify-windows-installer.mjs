import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require(path.resolve("package.json"));
const releaseDir = path.resolve("release", pkg.version);
const installer = path.join(releaseDir, `HostDeck-Setup-${pkg.version}-x64.exe`);
const latestInstaller = path.resolve("release", "HostDeck-Setup-LATEST.exe");
const unpacked = path.join(releaseDir, "win-unpacked");
const unpackedExe = path.join(unpacked, "HostDeck.exe");
const genericElectronExe = path.join(unpacked, "electron.exe");
const appRoot = path.join(unpacked, "resources", "app");
const appPackage = path.join(appRoot, "package.json");
const appMain = path.join(appRoot, "electron", "main.cjs");
const standaloneServer = path.join(unpacked, "resources", "standalone", "server.js");
const runtimeNext = path.join(unpacked, "resources", "standalone", "runtime_modules", "next", "package.json");

function fail(message) {
  console.error(`\nERRO: ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(installer)) fail(`instalador oficial ausente: ${installer}`);
if (!fs.existsSync(latestInstaller)) fail(`atalho de instalador LATEST ausente: ${latestInstaller}`);
if (fs.statSync(installer).size < 10 * 1024 * 1024) fail(`instalador parece incompleto: ${installer}`);
if (!fs.existsSync(unpackedExe)) fail(`HostDeck.exe não foi criado: ${unpackedExe}`);
if (fs.existsSync(genericElectronExe)) fail(`electron.exe genérico encontrado no pacote: ${genericElectronExe}`);
if (!fs.existsSync(appPackage)) fail(`pacote principal do app ausente. Sem ele o Electron abre a tela padrão: ${appPackage}`);
if (!fs.existsSync(appMain)) fail(`main do HostDeck ausente: ${appMain}`);
if (!fs.existsSync(standaloneServer)) fail(`servidor Next standalone ausente: ${standaloneServer}`);
if (!fs.existsSync(runtimeNext)) fail(`runtime do Next ausente: ${runtimeNext}`);

const packedPkg = JSON.parse(fs.readFileSync(appPackage, "utf8"));
if (packedPkg.name !== "hostdeck") fail(`resources/app/package.json incorreto: name=${packedPkg.name}`);
if (packedPkg.main !== "electron/main.cjs") fail(`main empacotado incorreto: ${packedPkg.main}`);

console.log("\nPacote Windows validado com sucesso:");
console.log(`- Instalador: ${installer}`);
console.log(`- LATEST:     ${latestInstaller}`);
console.log(`- Executável: ${unpackedExe}`);
console.log(`- App root:   ${appRoot}`);
console.log(`- Main:       ${appMain}`);
console.log(`- Next:       ${runtimeNext}`);
console.log("O pacote contém resources/app e não deve cair no Default App do Electron.\n");
