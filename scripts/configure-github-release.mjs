import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const input = process.argv[2]?.trim();

if (!input) {
  console.error("Uso: npm run github:setup -- SEU_USUARIO/hostdeck");
  console.error("Também aceita: https://github.com/SEU_USUARIO/hostdeck");
  process.exit(1);
}

const normalized = input
  .replace(/^https?:\/\/github\.com\//i, "")
  .replace(/^git@github\.com:/i, "")
  .replace(/\.git$/i, "")
  .replace(/^\/+|\/+$/g, "");

const [owner, repo, ...extra] = normalized.split("/");
if (!owner || !repo || extra.length) {
  console.error("Repositorio invalido. Use no formato SEU_USUARIO/hostdeck.");
  process.exit(1);
}

const packagePath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.repository = { type: "git", url: `https://github.com/${owner}/${repo}.git` };
pkg.homepage = `https://github.com/${owner}/${repo}`;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

fs.writeFileSync(
  path.join(root, ".hostdeck-github.json"),
  `${JSON.stringify({ owner, repo }, null, 2)}\n`,
  "utf8",
);

console.log(`GitHub configurado para ${owner}/${repo}`);
console.log("Build local nao depende mais dessa configuracao.");
console.log("Build de release usara o repositorio acima e o canal latest.");
console.log('Agora rode: git add . && git commit -m "configura updates do GitHub"');
