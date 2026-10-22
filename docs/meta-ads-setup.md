# Integração oficial Meta Ads MCP e CLI

Atualizado em 2026-10-21.

Este documento acompanha a conexão do Codex ao servidor MCP oficial hospedado pela Meta e à CLI oficial `meta-ads`. A autorização deve permanecer somente de leitura até nova aprovação explícita.

## Estado verificado

| Componente | Estado | Evidência |
|---|---|---|
| Codex CLI | FUNCIONANDO | `codex-cli 0.163.0-alpha.11` |
| MCP oficial | CONFIGURADO, NÃO VALIDADO | `codex mcp get meta-ads`: habilitado, `streamable_http`, URL oficial, `required = false`, aprovação `prompt`, timeouts 30/90 s. O cliente OAuth local agora usa o App ID Meta `Alusa` (`1539790024019428`) e callback fixo. |
| OAuth do MCP | BLOQUEADO POR AUTORIZAÇÃO | O app `Alusa` já tem o caso `ADS_AGENTIC`, mas ainda não tem o callback `http://127.0.0.1:56676/callback/p3oJPar44nR2` permitido. A sessão Meta precisa de login; o consentimento MCP ainda não foi concluído. DCR/CIMD não são suportados pelo servidor. |
| Ferramentas MCP | BLOQUEADO POR AUTORIZAÇÃO | Nenhuma ferramenta ficou disponível para chamada nesta sessão porque o handshake exige OAuth válido; a autorização não pôde ser concedida enquanto o erro do app persistir. |
| Plugin privado Meta Ads | BLOQUEADO POR INCOMPATIBILIDADE | O parser do Codex CLI rejeitou o manifesto `created-by-me-remote/meta-ads` com `unknown field extensions`; a entrada global oficial `meta-ads` foi preservada separadamente. |
| CLI oficial | FUNCIONANDO | `meta-ads` 1.2.0 instalado pela fórmula `facebook/fb/meta-ads`; `meta --version`, `meta --help` e os comandos de leitura `--help` funcionaram. |
| Autenticação da CLI | BLOQUEADO POR AUTORIZAÇÃO | Não existe item `meta-ads-cli`/`ACCESS_TOKEN` no Keychain. O wrapper encerra sem exibir segredo. A CLI não oferece comando `auth login`. |
| Contas/campanhas/insights | BLOQUEADO POR AUTORIZAÇÃO | Nenhuma consulta real autenticada foi concluída. |
| Aprovação e segurança | FUNCIONANDO | O MCP exige aprovação `prompt`; nenhuma alteração de anúncios foi feita. A CLI permanece capaz de escrita, então seus comandos de escrita exigem aprovação específica antes de executar. |
| App Meta próprio | CONFIGURADO, NÃO VALIDADO | Após autorização do usuário, `ADS_AGENTIC` foi adicionado ao app ativo `Alusa`. A Meta lista privilégios obrigatórios de gestão além de `ads_read`; nenhuma consulta de anúncios foi feita com esse app. |

## Ambiente

- macOS Darwin arm64; shell zsh.
- Codex CLI `0.163.0-alpha.11`.
- No diagnóstico inicial: Python `3.14.6`; `uv 0.12.10`; Homebrew `7.0.9`. A fórmula Homebrew instalou sua dependência `python@3.14` na versão `3.14.8_3`.
- MCP `meta-ads` já existia em `~/.codex/config.toml`, apontando para `https://mcp.facebook.com/ads` e habilitado.
- O tap oficial `facebook/fb` foi adicionado e a fórmula oficial `facebook/fb/meta-ads` 1.2.0 foi instalada. A fórmula exige macOS arm64 e fornece o binário `/opt/homebrew/bin/meta`.
- A instalação Homebrew atualizou `ca-certificates`, `readline`, `sqlite`, `xz` e `python@3.14` e instalou `openssl@4` como dependências da fórmula. A cópia duplicada inicialmente instalada por `uv` foi removida.
- `uv tool update-shell` adicionou `~/.local/bin` ao `~/.zshenv`; reinicie o shell para aplicar em terminais já abertos.
- O comando `meta-auth` foi criado em `~/.local/bin/meta-auth`, com permissão `0700`. Ele lê `ACCESS_TOKEN` do Keychain `login`, sem imprimir o valor, e executa o binário oficial `/opt/homebrew/opt/meta-ads/bin/meta`.
- Nenhuma variável `ACCESS_TOKEN`, `AD_ACCOUNT_ID` ou `BUSINESS_ID` estava definida no ambiente durante o diagnóstico.

## Concluir a autorização do MCP

1. O login foi interrompido porque a Meta recusou o app OAuth pré-registrado original, mesmo com a sessão Meta ativa.
2. DCR e CIMD não são alternativas disponíveis para este servidor; a configuração `oauth.client_id` pré-registrada é obrigatória e tem precedência no Codex.
3. Com autorização explícita, o caso `ADS_AGENTIC` foi adicionado ao app Meta `Alusa` (`1539790024019428`). Isso habilita o caso no app e exige os privilégios de gestão listados pela Meta, inclusive `ads_management`.
4. O usuário deve entrar na sessão Meta Developer aberta no navegador. Depois, confirmar imediatamente antes de salvar a inclusão do callback `http://127.0.0.1:56676/callback/p3oJPar44nR2` nos OAuth Redirect URIs do app `Alusa`.
5. Em seguida, concluir `codex mcp login meta-ads --scopes ads_read`, iniciar nova sessão Codex para descobrir as ferramentas e validar com uma chamada MCP somente de leitura que liste contas. A autorização só conta como funcional quando a chamada real retornar dados.

Depois que o proprietário do app OAuth corrigir a configuração, gere novo fluxo com:

```sh
codex mcp login meta-ads --scopes ads_read
```

Não repita o fluxo atual enquanto o app continuar retornando “needs at least one supported permission”. Não use o conjunto amplo de escopos de gestão para estes testes de leitura. Se a Meta informar que `ads_read` não é suficiente para uma operação específica, peça autorização antes de adicionar outro escopo.

## Preparar autenticação da CLI

A CLI oficial exige a variável de ambiente `ACCESS_TOKEN`. O token usado pelo MCP não foi extraído nem reutilizado. Gere um token Meta com acesso de leitura `ads_read` e acesso ao ativo de anúncios desejado. O fluxo exato depende do tipo de token e das permissões do app Meta; use a documentação oficial de autenticação da Marketing API. Não habilite `ads_management` para estas consultas.

Crie manualmente um item de senha genérica no app **Acesso às Chaves** do macOS:

- Chaves: `login`.
- Nome do item/serviço: `meta-ads-cli`.
- Conta: `ACCESS_TOKEN`.
- Senha: token Meta emitido para uso da CLI com permissão de leitura.

Depois, valide sem imprimir o token:

```sh
~/.local/bin/meta-auth auth status
```

Use a CLI pelo wrapper `~/.local/bin/meta-auth`, que lê o segredo do Keychain somente para o processo da CLI. Não passe token literal em argumentos, não o cole no chat e não o salve em arquivos do projeto.

## Consultas de leitura disponíveis

Confirme os comandos na versão instalada antes de usá-los:

```sh
meta --help
meta auth --help
meta ads adaccount --help
meta ads campaign list --help
meta ads insights get --help
```

Depois da autenticação e da seleção do ID correto da conta:

```sh
~/.local/bin/meta-auth ads adaccount list
~/.local/bin/meta-auth ads campaign list --limit 25
~/.local/bin/meta-auth ads --ad-account-id act_ID_DA_CONTA insights get --date-preset last_7d
```

O campo `act_ID_DA_CONTA` é um marcador e deve ser substituído pelo ID retornado pela consulta. Respeite moeda, fuso horário e janela de atribuição ao apresentar métricas. Não inclua tokens em relatórios.

## Fontes oficiais consultadas

- [Visão geral do Meta Ads MCP](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-overview)
- [Primeiros passos do Meta Ads MCP](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-get-started)
- [Ferramentas do Meta Ads MCP](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-tools)
- [Meta Ads CLI](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-cli/ads-cli-overview)
- [Pacote oficial `meta-ads` no PyPI](https://pypi.org/project/meta-ads/)
- [Tap oficial Homebrew `facebook/homebrew-fb`](https://github.com/facebook/homebrew-fb)
- [MCP no Codex](https://developers.openai.com/codex/mcp)
- [Referência de configuração do Codex](https://developers.openai.com/codex/config-reference)

As páginas da documentação Meta retornaram bloqueio/limite de acesso automatizado durante esta execução. A instalação e as opções da CLI foram verificadas com os metadados do PyPI e os `--help` do binário oficial instalado.
