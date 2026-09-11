# HostDeck 1.4.2 — Infrastructure OS

HostDeck é um painel local/Desktop em **Next.js + Electron** para centralizar hospedagens, aplicações, logs, ações, alertas, Discord e Gemini Intelligence.

## Novidades da 1.4.2

- Tipografia e números maiores, com melhor legibilidade sem exagero.
- Cards de aplicações continuam compactos, mas agora **abrem os detalhes em um modal central**.
- O modal fecha pelo `X`, tecla `Esc` ou clique fora e possui animação suave.
- Botões, tabs, configurações, modais e controles da janela receberam animações e estados mais refinados.
- Plugin Hub com o card inteiro clicável.
- Ícones locais e distintos para **Square Cloud, Vercel, Render, Netlify, Cloudflare, DigitalOcean e Heroku**.
- Titlebar personalizada com minimizar, maximizar/restaurar e fechar redesenhados.
- Gemini Intelligence com chat privado, timeline de incidentes e alertas silenciosos/informativos.
- Economia de API: mudanças informativas não chamam Gemini por padrão; existe cooldown configurável para análises e notificações.
- **Auto Recovery protegido** opcional: se uma aplicação estava `online` e muda inesperadamente para `offline/error`, o HostDeck pode analisar o contexto e executar `Start/Resume` quando o plugin suporta.
- Auto Recovery nunca religa automaticamente aplicações `paused`, ignora `building/unknown`, respeita cooldown e limite de tentativas por hora.
- Ações manuais de `Stop/Pause` feitas pelo HostDeck entram em supressão para não serem desfeitas pelo monitor.
- Discord Webhook continua recebendo apenas incidentes relevantes e recuperações.
- Tema **Sistema / Dark / Light** e glassmorphism mantidos.

> **Importante:** Auto Recovery vem desligado por padrão. Ative em **Configurações → Inteligência IA → Recuperação automática protegida** depois de revisar os limites.

## Executar no Windows

Extraia o projeto em uma pasta nova e execute `INICIAR-WINDOWS.bat`, ou:

```powershell
npm install
npm run desktop:dev
```

Modo navegador:

```powershell
npm install
npm run dev
```

Depois abra `http://localhost:3000`.

## Plugins

Abra **Configurações → Plugins**. O catálogo atual inclui:

- Square Cloud
- Vercel
- Render
- Netlify
- Cloudflare Pages
- DigitalOcean App Platform
- Heroku

As credenciais ficam no backend local do Electron. Também é possível usar `.env.local` conforme `.env.example`.

## Gemini Intelligence

Abra **Configurações → Inteligência IA** e configure `GEMINI_API_KEY`.

O monitor possui opções para:

- intervalo de monitoramento;
- cooldown mínimo entre chamadas ao Gemini;
- cooldown de notificações repetidas;
- alertas informativos ligados/desligados;
- Auto Recovery ligado/desligado;
- cooldown de recuperação;
- limite de tentativas de recuperação por hora.

O Gemini recebe somente o contexto operacional necessário: aplicação, provider, estado, metadados, métricas e eventos. Chaves dos provedores não são enviadas ao Gemini.

### Como funciona o Auto Recovery

1. O HostDeck mantém um snapshot anterior.
2. A aplicação precisa ter estado `online` no snapshot anterior.
3. O novo estado precisa ser `offline` ou `error`.
4. O plugin precisa oferecer uma ação segura compatível (`start` ou `resume`).
5. O HostDeck verifica supressão de ação manual, cooldown e limite por hora.
6. Se Gemini estiver habilitado, ele analisa o provável papel da aplicação e decide se a tentativa é apropriada.
7. O HostDeck executa a ação e consulta o provider até confirmar `online` ou encerrar a janela de confirmação.
8. O resultado entra no Intelligence Inbox e, se configurado, no Discord.

O monitor **não executa Stop/Delete/Redeploy automaticamente**.

## Discord

1. Crie um Webhook no canal desejado.
2. Abra **Configurações → Notificações**.
3. Cole a URL e salve.
4. Clique em **Enviar teste**.

O webhook é secreto e não deve ser enviado ao GitHub.

## Build Desktop

```powershell
npm run desktop:dist
```

Os instaladores ficam em `dist/`.

## Atualizações via GitHub

O workflow `.github/workflows/release-desktop.yml` publica versões a partir de tags `v*`:

```powershell
npm run release:patch
git push --follow-tags
```

## Mídia dos cards

O HostDeck continua usando os dois GIFs configurados anteriormente através do proxy local `/api/media/*`. Se os links assinados do Discord expirarem, substitua por:

```env
HOSTDECK_APP_FALLBACK_URL=
HOSTDECK_BANNER_URL=
```

## Segurança

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- credenciais somente no backend local
- sem `--ignore-certificate-errors`
- Auto Recovery é opt-in, limitado e não atua em pausa/build
- ações manuais do HostDeck são protegidas contra recuperação automática imediata


## Gerar instalador e publicar atualizacoes

Windows local:

```powershell
npm install
npm run desktop:dist:win
```

Configure uma vez o repositorio GitHub usado pelo updater:

```powershell
npm run github:setup -- SEU_USUARIO/hostdeck
```

Depois de commitar suas mudancas, publique uma nova versao:

```powershell
npm run github:release:patch
```

Veja `docs/GITHUB-RELEASES.md` para o passo a passo completo.


## Diagnóstico do aplicativo empacotado

A versão 1.4.2 grava o log principal em `%APPDATA%\HostDeck\logs\main.log`. Se o aplicativo não abrir, use `ABRIR-LOG-WINDOWS.bat`. O build local do Windows usa `npm run desktop:dist:win` e nunca publica automaticamente. Para publicar no GitHub Releases use `npm run desktop:publish:win` ou as rotinas `github:release:*`.

No GitHub Release, o executável do Windows termina em `.exe`. Os itens `Source code (zip)` e `Source code (tar.gz)` são arquivos automáticos do GitHub e não são o instalador.

## 1.4.3 — correção do build / GitHub updater

Se aparecer um erro como `Cannot detect repository`, `reading 'provider'` ou `reading 'channel'`, confirme primeiro a pasta no stack trace. Não compile versões antigas como `hostdeck-v1.1-electron`.

### Gerar apenas o instalador do Windows

O build local agora é totalmente separado do publish do GitHub e não precisa de `repository` nem de `publish`:

```powershell
npm install
npm run desktop:dist:win
```

Ou dê dois cliques em `GERAR-EXE-WINDOWS.bat`.

O instalador será criado em `dist/`.

### Configurar GitHub uma única vez

```powershell
npm run github:setup -- USUARIO/REPOSITORIO
```

Ou execute `CONFIGURAR-GITHUB-WINDOWS.bat`.

Esse comando grava `repository` no `package.json` e cria `.hostdeck-github.json`. Nenhuma chave/token é gravada nesse arquivo.

### Publicar atualização

Faça commit e envie o código. Depois use a tag/release pelo script:

```powershell
git add .
git commit -m "minhas alterações"
npm run github:release:patch
```

O GitHub Actions usa `GITHUB_REPOSITORY` e gera o `app-update.yml`/`latest.yml` com o canal `latest` somente nos builds de release. Builds locais não carregam canal de update e, por isso, nunca mais devem quebrar por configuração de publish ausente.

## Correção 1.4.6 — runtime Next.js no Electron

Se uma versão anterior fechava com `Cannot find module 'next'`, gere novamente o instalador com esta versão. O build agora prepara `.hostdeck-runtime/runtime_modules` e o Electron inicia o servidor com `NODE_PATH` apontando para essas dependências. O instalador inclui explicitamente `server.js`, `.next`, `public` e `runtime_modules`.

Para Windows:

```powershell
npm install
npm run desktop:dist:win
```

Ao abrir o app instalado, o log deve mostrar `version: 1.4.6` e o campo `runtimeModules` no evento `Iniciando servidor standalone`.
