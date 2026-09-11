import { rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
for (const name of [".next", "dist", ".hostdeck-runtime"]) {
  const target = path.join(root, name);
  await rm(target, { recursive: true, force: true });
}
console.log("Artefatos antigos removidos (.next, dist e .hostdeck-runtime).");
