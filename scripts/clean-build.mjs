import { rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const cleanAll = process.argv.includes("--all");
const targets = [".next", ".hostdeck-runtime"];
if (cleanAll) targets.push("dist", "release");

async function removeWithRetry(target, { optional = false } = {}) {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
      return true;
    } catch (error) {
      const code = error?.code || "";
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(code) || attempt === maxAttempts) {
        if (optional) {
          console.warn(`Aviso: não foi possível remover ${target} (${code || "erro"}). O build continuará porque essa pasta não é necessária para o Next.js.`);
          return false;
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
  return false;
}

for (const name of targets) {
  const target = path.join(root, name);
  await removeWithRetry(target, { optional: cleanAll && ["dist", "release"].includes(name) });
}

console.log(cleanAll
  ? "Limpeza completa concluída (.next, .hostdeck-runtime, dist/release quando disponíveis)."
  : "Runtime de build limpo (.next e .hostdeck-runtime). Artefatos/instaladores anteriores foram preservados.");
