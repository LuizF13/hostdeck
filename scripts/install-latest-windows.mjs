import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

if (process.platform !== "win32") throw new Error("Este comando é exclusivo do Windows.");
const installer = path.resolve("release", "HostDeck-Setup-LATEST.exe");
if (!fs.existsSync(installer)) throw new Error(`Instalador não encontrado: ${installer}`);
console.log(`Abrindo instalador oficial: ${installer}`);
const child = spawn(installer, [], { detached: true, stdio: "ignore" });
child.unref();
