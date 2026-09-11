# GitHub Releases e atualizacao automatica do HostDeck

O HostDeck usa `electron-updater` e `electron-builder`. O instalador produzido pelo GitHub Actions recebe um `app-update.yml` apontando para o repositorio configurado. Por isso o repositorio de atualizacoes deve ser configurado antes da primeira release publica.

## 1. Crie um repositorio vazio no GitHub

Exemplo: `SEU_USUARIO/hostdeck`.

Para o updater do GitHub funcionar sem exigir um token em cada computador, prefira um repositorio publico para as Releases. Nunca envie `.env.local`; ele ja esta no `.gitignore`.

## 2. Configure o destino de atualizacao no projeto

```powershell
npm run github:setup -- SEU_USUARIO/hostdeck
```

Isso grava o repositorio no `package.json` e tambem `owner`/`repo` no `electron-builder.yml`.

## 3. Primeiro push

```powershell
git init
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/hostdeck.git
git add .
git commit -m "HostDeck 1.4.1"
git push -u origin main
```

## 4. Gerar um instalador Windows localmente

```powershell
npm install
npm run desktop:dist:win
```

O instalador fica em `dist/`.

## 5. Publicar uma nova atualizacao

Depois de editar e testar:

```powershell
git add .
git commit -m "melhora o HostDeck"
npm run github:release:patch
```

O ultimo comando incrementa a versao, cria a tag `vX.Y.Z` e envia commit + tag. A tag dispara `.github/workflows/release-desktop.yml`.

Para uma versao minor ou major:

```powershell
npm run github:release:minor
npm run github:release:major
```

No Windows tambem existe `PUBLICAR-GITHUB-WINDOWS.bat` para o fluxo `patch`.

## 6. O que o GitHub Actions publica

O workflow cria os pacotes Windows, Linux e macOS e envia para GitHub Releases. Para o Windows, o `electron-builder` tambem publica o arquivo de metadados `latest.yml`, utilizado pelo botao de atualizacao do HostDeck.

## 7. Teste real do updater

1. Instale a versao `1.4.1` gerada por uma GitHub Release.
2. Altere o codigo e publique `1.4.2`.
3. Abra a versao instalada `1.4.1`.
4. Clique em **Atualizacoes -> Verificar atualizacao**.
5. Baixe e instale a nova versao.

O updater nao deve ser testado usando `npm run desktop:dev`; nesse modo o HostDeck informa que atualizacoes estao indisponiveis.
