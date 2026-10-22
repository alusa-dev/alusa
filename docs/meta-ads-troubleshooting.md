# Diagnóstico Meta Ads MCP e CLI

Atualizado em 2026-10-21.

## MCP retorna `OAuth authorization required`

O servidor `meta-ads` está registrado e habilitado, mas a configuração não prova que existe um token de acesso utilizável. Durante a verificação, o Codex CLI recebeu `Auth required` ao inicializar a conexão e informou que o refresh token precisa de nova autorização. Ao solicitar somente `ads_read`, a página oficial da Meta exibiu “Parece que esse app não está disponível. Este app precisa pelo menos de uma supported permission.” A sessão Meta abriu, mas o app OAuth não apresentou a tela de consentimento.

O desafio `WWW-Authenticate` do servidor listou também escopos de gestão e outros produtos (`ads_management`, `catalog_management`, `business_management`, permissões de páginas/Instagram e `ads_mcp_management`). Nenhum escopo amplo foi concedido. Não solicite todos automaticamente; confirme com o proprietário do app qual permissão é suportada e estritamente necessária para leitura.

Testes adicionais confirmaram que o bloqueio está no registro OAuth da Meta, não no escopo solicitado pelo Codex:

- Com o `client_id` pré-registrado `942606585062970`, o login com apenas `ads_read` chega à Meta, que mostra o erro de app indisponível e não apresenta consentimento.
- Sem `client_id`, o servidor oficial responde `invalid_client_metadata: Dynamic registration is not available for this client` ao tentar DCR.
- A tentativa CIMD também não é suportada: o servidor de autorização não anuncia CIMD com método de autenticação de token `none`.
- A documentação do Codex confirma que um `oauth.client_id` configurado tem precedência e ignora o registro dinâmico. Portanto, DCR/CIMD não contornam a falha do app pré-registrado.

Uma consulta somente de leitura ao Meta Developer Tools oficial encontrou o app `Alusa` (`1539790024019428`) ativo, inicialmente configurado apenas com o caso de uso WhatsApp e sem redirect OAuth cadastrado. Após autorização explícita do usuário, o caso de uso `ADS_AGENTIC` foi adicionado. A Meta lista como privilégios obrigatórios `ads_mcp_management`, `ads_read`, `ads_management`, `business_management`, permissões de catálogo, páginas e Instagram. A lista de privilégios ainda não mostra concessões e nenhum consentimento de usuário foi concluído.

O Codex foi configurado para usar o App ID `1539790024019428` e um callback local fixo: `http://127.0.0.1:56676/callback/p3oJPar44nR2`. Esse endereço ainda precisa ser incluído nos OAuth Redirect URIs do app Meta. A aba de login do Meta Developer foi aberta no navegador isolado; o usuário precisa entrar na conta Meta antes de continuar. O login do Codex continuará solicitando apenas `ads_read`.

Para autorizar somente leitura:

```sh
codex mcp login meta-ads --scopes ads_read
```

Não repita o login enquanto esse erro persistir. O proprietário do app OAuth precisa garantir que o app tenha uma permissão suportada para esse fluxo e que `ads_read` esteja disponível para a integração. Depois da correção, refaça o login no domínio oficial e valide com uma chamada real de leitura. A mensagem de sucesso do comando, sozinha, não valida acesso às contas.

## O plugin privado não carrega pelo parser do CLI

O Codex CLI registrou este aviso para o plugin privado `created-by-me-remote/meta-ads`: `unknown field extensions, expected url or headers`. Não edite arquivos dentro de `~/.codex/plugins/cache` manualmente. Existe também uma entrada global `meta-ads` em `~/.codex/config.toml`, apontando para o endpoint oficial. O aviso do manifesto é separado do erro OAuth; corrigir o manifesto não resolverá o app OAuth indisponível.

## CLI retorna `Not authenticated. Set the ACCESS_TOKEN environment variable.`

A CLI usa um token próprio via `ACCESS_TOKEN`; ela não importa automaticamente o OAuth do MCP. O token MCP não foi copiado nem testado com a CLI.

Guarde um token de leitura no Keychain do macOS com serviço `meta-ads-cli` e conta `ACCESS_TOKEN`. Em seguida, use `~/.local/bin/meta-auth`, que busca a senha diretamente do Keychain e não a mostra no terminal. O wrapper chama `/opt/homebrew/opt/meta-ads/bin/meta`. Não coloque token em shell history, `.env`, configuração do Codex, relatórios ou repositório.

## Homebrew não encontra `meta-ads`

Antes de adicionar o tap oficial, `brew info meta-ads` retornou `No available formula`. A solução foi adicionar `facebook/fb` e instalar `facebook/fb/meta-ads` 1.2.0, fórmula ARM64 oficial que fornece `meta`. O comando inicial `uv tool install meta-ads` foi removido após a instalação Homebrew para evitar conflito de `PATH`.

## Ferramentas ou dados ainda não aparecem

Não afirme que a integração está pronta até que uma operação MCP autenticada liste as contas. Neste ambiente, o próximo passo é entrar no Meta Developer no navegador, incluir o callback local nos OAuth Redirect URIs do app `Alusa` e então concluir o login Codex com `ads_read`. O usuário autorizou a inclusão do caso de uso `ADS_AGENTIC`, mas o callback deve ser confirmado imediatamente antes de salvar pela interface web. Não contorne discovery OAuth, PKCE, issuer ou redirect URI, e não troque o endpoint por proxy.

Nenhuma campanha, anúncio, público, orçamento ou catálogo deve ser criado ou alterado durante o diagnóstico.
