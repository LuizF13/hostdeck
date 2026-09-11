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
