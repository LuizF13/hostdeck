# Atualizações do HostDeck

A configuração completa foi movida para [GITHUB-RELEASES.md](./GITHUB-RELEASES.md).

## Comandos rápidos

Gerar instalador Windows local:

```powershell
npm install
npm run desktop:dist:win
```

Configurar uma vez o repositório usado pelo updater:

```powershell
npm run github:setup -- SEU_USUARIO/hostdeck
```

Depois de testar e commitar as mudanças, publicar uma atualização patch:

```powershell
npm run github:release:patch
```

Isso cria uma nova tag `vX.Y.Z` e faz push. O workflow `Release Desktop` gera os instaladores e os arquivos do `electron-updater` no GitHub Release.

## HostDeck 1.5.2 — atualização automática e GitHub 404

O HostDeck 1.5.2 verifica atualizações automaticamente ao iniciar e, por padrão, a cada 30 minutos enquanto o processo estiver rodando. Quando o modo "Continuar em segundo plano ao fechar" está ativo, fechar a janela envia o HostDeck para a bandeja do Windows; monitoramento e atualizações continuam ativos. A opção "Iniciar com o Windows" pode iniciar esse agente em segundo plano no login.

Se o updater mostrar `404 ... /releases.atom`, o repositório configurado no `app-update.yml` não pode ser acessado anonimamente. Para distribuir updates para usuários sem expor tokens, o repositório usado para GitHub Releases precisa existir e ser público. Se o código-fonte precisar permanecer privado, use um repositório público separado apenas para as releases/binários e configure o build para publicar nele.

O app totalmente encerrado não consegue consultar novas versões por conta própria. O modo em segundo plano é o mecanismo suportado pelo HostDeck para continuar atualizando sem manter a janela aberta.
