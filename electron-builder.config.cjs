const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const pkg = require(path.join(root, 'package.json'));

function parseGithubSlug(value) {
  if (!value) return null;
  const normalized = String(value)
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = normalized.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

function configuredGithubRepo() {
  const fromEnv = parseGithubSlug(process.env.HOSTDECK_GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY);
  if (fromEnv) return fromEnv;

  const localConfig = path.join(root, '.hostdeck-github.json');
  if (fs.existsSync(localConfig)) {
    try {
      const json = JSON.parse(fs.readFileSync(localConfig, 'utf8'));
      if (json && json.owner && json.repo) return { owner: String(json.owner), repo: String(json.repo) };
    } catch {}
  }

  const repositoryUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return parseGithubSlug(repositoryUrl);
}

const releaseBuild = process.env.HOSTDECK_RELEASE === '1';
const githubRepo = configuredGithubRepo();

if (releaseBuild && !githubRepo) {
  throw new Error(
    'Repositorio de atualizacao nao configurado. Rode: npm run github:setup -- SEU_USUARIO/SEU_REPOSITORIO'
  );
}

const config = {
  appId: 'com.hostdeck.desktop',
  productName: 'HostDeck',
  directories: {
    output: 'dist',
    buildResources: 'build',
  },
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  files: [
    'electron/**/*',
    'build/icon.png',
    'build/icon.ico',
    'build/icon.icns',
    'package.json',
  ],
  extraResources: [
    { from: '.hostdeck-runtime/server.js', to: 'standalone/server.js' },
    { from: '.hostdeck-runtime/package.json', to: 'standalone/package.json' },
    { from: '.hostdeck-runtime/.next', to: 'standalone/.next', filter: ['**/*'] },
    { from: '.hostdeck-runtime/runtime_modules', to: 'standalone/runtime_modules', filter: ['**/*'] },
    { from: '.hostdeck-runtime/public', to: 'standalone/public', filter: ['**/*'] },
  ],
  asar: true,
  win: {
    icon: 'build/icon.ico',
    target: ['nsis'],
  },
  nsis: {
    oneClick: false,
    shortcutName: 'HostDeck',
    uninstallDisplayName: 'HostDeck',
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  mac: {
    icon: 'build/icon.icns',
    target: ['dmg', 'zip'],
  },
  linux: {
    icon: 'build/icon.png',
    target: ['AppImage'],
    category: 'Utility',
  },
};

if (releaseBuild) {
  config.publish = [{
    provider: 'github',
    owner: githubRepo.owner,
    repo: githubRepo.repo,
    channel: 'latest',
  }];
}

module.exports = config;
