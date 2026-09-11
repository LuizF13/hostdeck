import { execFileSync } from "node:child_process";

const level = process.argv[2] || "patch";
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
  if (!/github\.com[:/]/i.test(origin)) throw new Error("O remote origin nao aponta para o GitHub.");
  const dirty = output("git", ["status", "--porcelain"]);
  if (dirty) {
    console.error("Ha alteracoes ainda nao commitadas. Primeiro rode:");
    console.error('  git add .');
    console.error('  git commit -m "minhas alteracoes"');
    process.exit(2);
  }
  run("npm", ["version", level, "-m", "release: v%s"]);
  run("git", ["push", "origin", "HEAD", "--follow-tags"]);
  console.log("Release enviado. O GitHub Actions vai gerar os instaladores e publicar o GitHub Release.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
