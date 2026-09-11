import { execFileSync } from "node:child_process";

const level = process.argv[2] || "patch";
const customMessage = process.argv.slice(3).join(" ").trim();

if (!["patch", "minor", "major"].includes(level)) {
  console.error("Use patch, minor ou major.");
  process.exit(1);
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...options });
}
function output(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" }).trim();
}

try {
  const origin = output("git", ["remote", "get-url", "origin"]);
  if (!/github\.com[:/]/i.test(origin)) {
    throw new Error("O remote origin nao aponta para o GitHub. Configure primeiro com npm run github:setup -- USUARIO/REPOSITORIO");
  }

  const branch = output("git", ["branch", "--show-current"]);
  if (!branch) throw new Error("Nao foi possivel detectar a branch atual.");

  // Valida o projeto antes de criar a release.
  run("npm", ["run", "build"]);

  const dirty = output("git", ["status", "--porcelain"]);
  if (dirty) {
    run("git", ["add", "."]);
    const message = customMessage || "feat: atualizar HostDeck";
    run("git", ["commit", "-m", message]);
  }

  run("npm", ["version", level, "-m", "release: v%s"]);
  const version = output("node", ["-p", "require('./package.json').version"]);
  run("git", ["push", "origin", branch]);
  run("git", ["push", "origin", `v${version}`]);

  console.log("");
  console.log(`HostDeck v${version} enviado para o GitHub.`);
  console.log("O GitHub Actions vai gerar o instalador HostDeck-Setup-<versao>-x64.exe e publicar a Release.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
