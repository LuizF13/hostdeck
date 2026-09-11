# HostDeck Intelligence — 1.4.0

O HostDeck usa o Gemini em três situações controladas:

1. **Análise de incidentes relevantes**: o monitor compara snapshots localmente e só chama o Gemini quando existe uma mudança importante e o cooldown permite.
2. **Auto Recovery protegido**: quando uma aplicação estava online e muda inesperadamente para offline/erro, o Gemini pode analisar o contexto da aplicação antes de autorizar uma tentativa segura de `start`/`resume`.
3. **Intelligence Inbox**: chat privado com o snapshot atual e os alertas recentes como contexto.

Mudanças informativas não chamam Gemini por padrão. O intervalo mínimo entre análises é configurável em **Configurações → Inteligência IA**.

## Proteções do Auto Recovery

- desligado por padrão;
- apenas `online → offline/error`;
- não atua em `paused`, `building` ou `unknown`;
- nunca executa ações destrutivas;
- ações manuais de Stop/Pause feitas no HostDeck entram em supressão;
- cooldown e limite de tentativas por hora configuráveis;
- se a análise não tiver evidência suficiente, o Gemini pode bloquear a recuperação.

O Gemini não recebe as chaves dos provedores. O payload contém somente informações operacionais necessárias, como nome, provider, status, URL, linguagem, métricas disponíveis, deployment e eventos detectados.

Configure em **Configurações → Inteligência IA**.
