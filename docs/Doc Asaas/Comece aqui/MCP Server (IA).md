

# MCP Server (IA)

O desenvolvimento de software está sendo transformado por assistentes de IA. Para ajudar você a construir, depurar e integrar com o Asaas de forma mais rápida e inteligente, estamos introduzindo duas novas funcionalidades focadas em IA: o **Servidor MCP** e o **LLMs.txt**.

Este guia explica o que são essas ferramentas e como você pode usá-las para potencializar sua integração.

## Conecte seu Assistente de IA Diretamente à API do Asaas

O Model Context Protocol (MCP) é um padrão que permite que assistentes de IA entendam e interajam programaticamente com APIs.

Disponibilizamos um servidor MCP público que converte nossa especificação OpenAPI em um recurso estruturado que seu assistente de IA pode consumir.

### O que você pode fazer com isso?

Ao conectar seu assistente de IA ao nosso servidor MCP, você o habilita a:

* Listar endpoints disponíveis em nossa API.
* Obter schemas detalhados de requisição e resposta para qualquer endpoint.
* Gerar exemplos de código (snippets) para interagir com endpoints específicos.
* Executar chamadas de API diretamente do seu editor (requer autenticação).
* Pesquisar nossa documentação técnica.

### Como usar?

Seu ponto de acesso ao nosso Servidor MCP é: [https://docs.asaas.com/mcp](https://docs.asaas.com/mcp)

Você pode adicionar esta URL diretamente em sua ferramenta de desenvolvimento de IA.

### Autenticando requisições

Para permitir que seu assistente de IA execute requisições, você deve fornecer seu `access_token` do Asaas de forma segura. O servidor MCP em si é público, mas a execução de chamadas de API usa a sua chave privada.

### Exemplos de configuração

Você pode configurar sua ferramenta para injetar seu `access_token` com segurança. Existem exemplos de configuração para os seguintes assistentes:

* <br />

  <Tabs>
    <Tab title="Cursor">
      **Add to`~/.cursor/mcp.json`:**

      ```json
      {
        "mcpServers": {
          "asaas": {
            "url": "https://docs.asaas.com/mcp"
          }
        }
      }
      ```
    </Tab>

    <Tab title="Windsurf">
      **Add to`~/.codeium/windsurf/mcp_config.json`:**

      ```json
      {
        "mcpServers": {
          "asaas": {
            "url": "https://docs.asaas.com/mcp"
          }
        }
      }
      ```
    </Tab>

    <Tab title="Claude Desktop">
      **Add to`claude_desktop_config.json`:**

      ```json
      {
        "mcpServers": {
          "asaas": {
            "url": "https://docs.asaas.com/mcp"
          }
        }
      }
      ```
    </Tab>
  </Tabs>

Clique [aqui](https://docs.readme.com/main/docs/readmes-mcp-server) para acessar os exemplos de configuração.

### Testando sua Configuração

Após configurar, tente perguntar ao seu assistente:

* "*Como eu crio um novo cliente no Asaas?*"
* "*Mostre-me um exemplo para o endpoint /v3/subscriptions*."
* "*Quais são os parâmetros para tokenizar um cartão de crédito?*"

### Avançado: Usando diferentes versões da API

Por padrão, o servidor MCP usa a última versão estável da nossa documentação. Para acessar uma versão ou branch diferente, você pode adicionar o parâmetro `?branch=<nome_do_branch>` à URL do MCP.

## Garantindo respostas de IA precisas sobre nossa API

O **LLMs.txt** é um arquivo de configuração que "ensina" modelos de IA a entender e representar corretamente nossa documentação.

### Qual o benefício?

Quando você ou outros desenvolvedores fazem perguntas sobre a API do Asaas em IAs públicas, este arquivo ajuda a garantir que as respostas sejam:

* **Precisas**: Reduz a chance de "alucinações" sobre nossos endpoints.
* **Atualizadas**: Guia os modelos para as informações mais recentes sobre versões e parâmetros.
* **Consistentes**: Assegura que a IA use a terminologia correta.

### Como usar?

Você não precisa fazer nada! Este é um benefício passivo.

O Asaas mantém este arquivo atualizado automaticamente. Modelos de IA que suportam este padrão, irão verificá-lo antes de gerar respostas sobre nossa API, resultando em respostas mais confiáveis para você.

Para transparência, você pode ver o arquivo em: [https://docs.asaas.com/llms.txt](https://docs.asaas.com/llms.txt)

### Reporte problemas identificados

Caso identifique alguma resposta errada por parte da IA, ou algo que pode ser melhorado, pedimos que nos comunique através do e-mail [integracoes@asaas.com.br](mailto:integracoes@asaas.com.br) para que possamos tomar as medidas necessárias.

Agradecemos pela sua colaboração!