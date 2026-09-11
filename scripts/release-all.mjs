import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const level = process.argv[2] || "patch";
const customMessage = process.argv.slice(3).join(" ").trim();

if (!["patch", "minor", "major"].includes(level)) {
  console.error("Use patch, minor ou major.");
  process.exit(1);
}

/*
 * Quando este script é iniciado por:
 *
 * npm run release
 *
 * o npm informa o caminho real do npm-cli.js através de npm_execpath.
 *
 * No Windows isso evita o erro:
 *
 * spawnSync npm.cmd EINVAL
 */
const npmCli = process.env.npm_execpath;

function runNpm(args) {
  if (!npmCli) {
    throw new Error(
      "Nao foi possivel localizar o npm CLI através de process.env.npm_execpath."
    );
  }

  return execFileSync(process.execPath, [npmCli, ...args], {
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
}

function runGit(args, options = {}) {
  return execFileSync(
    process.platform === "win32" ? "git.exe" : "git",
    args,
    {
      stdio: "inherit",
      shell: false,
      windowsHide: true,
      ...options,
    }
  );
}

function gitOutput(args) {
  return execFileSync(
    process.platform === "win32" ? "git.exe" : "git",
    args,
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    }
  ).trim();
}

function nodeOutput(args) {
  return execFileSync(process.execPath, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  }).trim();
}

function tagExists(tag) {
  try {
    execFileSync(
      process.platform === "win32" ? "git.exe" : "git",
      ["rev-parse", "-q", "--verify", `refs/tags/${tag}`],
      {
        stdio: "ignore",
        shell: false,
        windowsHide: true,
      }
    );

    return true;
  } catch {
    return false;
  }
}

function hasChanges() {
  return Boolean(gitOutput(["status", "--porcelain"]));
}

try {
  console.log("");
  console.log("======================================");
  console.log(" HostDeck Release");
  console.log("======================================");
  console.log("");

  /*
   * Verifica Git
   */
  const origin = gitOutput([
    "remote",
    "get-url",
    "origin",
  ]);

  if (!/github\.com[:/]/i.test(origin)) {
    throw new Error(
      "O remote origin nao aponta para o GitHub."
    );
  }

  const branch = gitOutput([
    "branch",
    "--show-current",
  ]);

  if (!branch) {
    throw new Error(
      "Nao foi possivel detectar a branch atual."
    );
  }

  console.log(`Repositorio: ${origin}`);
  console.log(`Branch: ${branch}`);
  console.log("");

  /*
   * 1. Build
   */
  console.log("[1/6] Validando o projeto...");
  console.log("");

  runNpm([
    "run",
    "build",
  ]);

  /*
   * 2. Commit das alterações atuais
   */
  console.log("");
  console.log("[2/6] Salvando alteracoes pendentes...");
  console.log("");

  if (hasChanges()) {
    runGit([
      "add",
      ".",
    ]);

    const commitMessage =
      customMessage ||
      "feat: atualizar HostDeck";

    runGit([
      "commit",
      "-m",
      commitMessage,
    ]);
  } else {
    console.log(
      "Nenhuma alteracao de codigo pendente."
    );
  }

  /*
   * 3. Incrementar versão
   */
  console.log("");
  console.log(
    `[3/6] Incrementando versao (${level})...`
  );
  console.log("");

  runNpm([
    "version",
    level,
    "--no-git-tag-version",
    "--ignore-scripts",
  ]);

  const version = nodeOutput([
    "-p",
    "require('./package.json').version",
  ]);

  const tag = `v${version}`;

  console.log("");
  console.log(`Nova versao: ${version}`);

  if (tagExists(tag)) {
    throw new Error(
      `A tag ${tag} ja existe no repositorio.`
    );
  }

  /*
   * 4. Commit da versão + tag
   */
  console.log("");
  console.log(
    `[4/6] Criando commit e tag ${tag}...`
  );
  console.log("");

  const versionFiles = [
    "package.json",
  ];

  if (existsSync("package-lock.json")) {
    versionFiles.push("package-lock.json");
  }

  runGit([
    "add",
    ...versionFiles,
  ]);

  if (hasChanges()) {
    runGit([
      "commit",
      "-m",
      `release: ${tag}`,
    ]);
  }

  runGit([
    "tag",
    "-a",
    tag,
    "-m",
    `HostDeck ${tag}`,
  ]);

  /*
   * 5. Push branch
   */
  console.log("");
  console.log(
    "[5/6] Enviando codigo ao GitHub..."
  );
  console.log("");

  runGit([
    "push",
    "origin",
    branch,
  ]);

  /*
   * 6. Push tag
   */
  console.log("");
  console.log(
    `[6/6] Publicando ${tag}...`
  );
  console.log("");

  runGit([
    "push",
    "origin",
    tag,
  ]);

  console.log("");
  console.log("======================================");
  console.log(` HostDeck ${tag} publicado`);
  console.log("======================================");
  console.log("");
  console.log(
    "O GitHub Actions agora deve:"
  );
  console.log("");
  console.log(
    "  1. Compilar o HostDeck"
  );
  console.log(
    "  2. Gerar o instalador Windows"
  );
  console.log(
    "  3. Gerar latest.yml"
  );
  console.log(
    "  4. Criar a GitHub Release"
  );
  console.log(
    "  5. Disponibilizar a atualizacao"
  );
  console.log("");

} catch (error) {
  console.error("");
  console.error(
    "======================================"
  );
  console.error(
    " Falha ao publicar a release"
  );
  console.error(
    "======================================"
  );
  console.error("");

  console.error(
    error instanceof Error
      ? error.message
      : String(error)
  );

  console.error("");
  process.exit(1);
}