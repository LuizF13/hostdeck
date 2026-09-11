# Identidade do HostDeck no Windows

A versão 1.5.0 trata o HostDeck como aplicativo Windows independente do Electron durante o uso empacotado.

- Executável instalado: `HostDeck.exe`.
- AppUserModelID de produção: `com.hostdeck.desktop`.
- AppUserModelID de desenvolvimento: `com.hostdeck.desktop.dev`.
- Área de Trabalho e Menu Iniciar são verificados/recriados no boot do app empacotado.
- Os atalhos apontam para `HostDeck.exe`, usam o ícone embutido no executável e recebem o AppUserModelID de produção.
- A janela define explicitamente os detalhes da taskbar, incluindo comando de relançamento e ícone.
- No desenvolvimento, o relaunch da taskbar inclui o caminho do projeto para evitar abrir a tela padrão do Electron sem aplicativo.
- O build valida que `win-unpacked/HostDeck.exe` existe e que não há um `electron.exe` genérico no pacote final.

## Pin antigo do Electron

Um pin criado anteriormente a partir de `node_modules/electron/dist/electron.exe` pertence ao executável genérico do Electron. O Windows guarda esse destino no pin, portanto ele não pode ser convertido com segurança em HostDeck depois de criado.

Após instalar esta versão, abra **HostDeck** pelo Menu Iniciar. Se ainda existir um pin antigo chamado **Electron**, desafixe somente esse pin antigo e fixe a janela HostDeck aberta. Os novos pins usam a identidade e o comando de relançamento corretos.
