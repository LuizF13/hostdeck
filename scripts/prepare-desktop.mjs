import { cp, mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const runtime = path.join(root, ".hostdeck-runtime");

if (!existsSync(standalone)) {
  throw new Error(".next/standalone não encontrado. Execute next build primeiro.");
}

await rm(runtime, { recursive: true, force: true });
await cp(standalone, runtime, { recursive: true, force: true });

const staticSource = path.join(root, ".next", "static");
const staticTarget = path.join(runtime, ".next", "static");
if (existsSync(staticSource)) {
  await mkdir(path.dirname(staticTarget), { recursive: true });
  await cp(staticSource, staticTarget, { recursive: true, force: true });
}

const publicSource = path.join(root, "public");
if (existsSync(publicSource)) {
  await cp(publicSource, path.join(runtime, "public"), { recursive: true, force: true });
}

// electron-builder pode ignorar diretórios chamados node_modules mesmo quando eles
// estão dentro de extraResources. Para evitar que o runtime do Next seja descartado,
// renomeamos o conjunto de dependências traçadas para runtime_modules e usamos NODE_PATH
// no processo filho do Electron.
const tracedNodeModules = path.join(runtime, "node_modules");
const runtimeModules = path.join(runtime, "runtime_modules");
if (!existsSync(tracedNodeModules)) {
  throw new Error(
    "O build standalone do Next não contém node_modules. Apague .next, execute npm install e rode o build novamente."
  );
}
await rm(runtimeModules, { recursive: true, force: true });
await rename(tracedNodeModules, runtimeModules);

const nextPackage = path.join(runtimeModules, "next", "package.json");
const serverFile = path.join(runtime, "server.js");
if (!existsSync(serverFile)) throw new Error(`Runtime incompleto: ${serverFile} não existe.`);
if (!existsSync(nextPackage)) {
  throw new Error(
    `Runtime incompleto: Next.js não foi localizado em ${nextPackage}. Execute npm install e gere o build novamente.`
  );
}

console.log("Runtime desktop preparado:");
console.log(`- servidor: ${serverFile}`);
console.log(`- módulos:  ${runtimeModules}`);
console.log("- Next.js validado para empacotamento Electron.");
