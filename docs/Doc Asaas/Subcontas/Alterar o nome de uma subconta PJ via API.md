# Alterar o nome de uma subconta PJ via API

Este guia detalha o processo para atualizar o nome da empresa (Razão Social ou Nome Fantasia) de uma subconta do tipo Pessoa Jurídica (PJ) através da API.

O fluxo foi desenhado para garantir que o nome utilizado na plataforma Asaas esteja sempre conforme os registros oficiais da Receita Federal, oferecendo segurança e consistência cadastral.

## O Processo em Duas Etapas

A alteração do nome é um processo que consiste em duas chamadas à API: primeiro, você consulta os nomes válidos e disponíveis para a subconta e, em seguida, envia a atualização com o nome escolhido.

### Consultar os Nomes Disponíveis

Antes de qualquer tentativa de atualização, é obrigatório consultar quais nomes de empresa estão disponíveis para o CNPJ da subconta.

Para isso, realize uma requisição `GET` para o endpoint de [Recuperar dados comerciais](https://docs.asaas.com/reference/recuperar-dados-comerciais), autenticando com a `access_token` da subconta específica que você deseja alterar.

Exemplo: `GET /v3/myAccount/commercialInfo/`

A resposta desta requisição conterá o atributo `availableCompanyNames`, que é uma lista com as opções de nomes (Razão Social e Nome Fantasia) que buscamos diretamente na Receita Federal.

Exemplo de Resposta:

```json
{  
  "object": "commercialInfo",  
  "email": "empresa@exemplo.com.br",  
  "companyName": "NOME ANTIGO DA EMPRESA LTDA",  
  "availableCompanyNames": [  
    "NOME ATUALIZADO DA EMPRESA LTDA",  
    "NOME FANTASIA ATUALIZADO"  
  ],  
  // ... outros campos  
}
```

<br />

**Armazene os nomes retornados em`availableCompanyNames`. Você precisará de um deles no próximo passo.**

### Enviar a Atualização com o Nome Escolhido

Com a lista de nomes válidos em mãos, você pode agora solicitar a atualização, enviando o nome desejado.

Realize uma requisição `POST` para o mesmo endpoint, também autenticado com a `access_token` da subconta, informando o campo `companyName` junto aos demais atributos necessários para [Atualizar os dados comerciais](https://docs.asaas.com/reference/atualizar-dados-comerciais) de uma conta.

No campo `companyName`, você deve informar exatamente um dos valores que foram retornados na lista `availableCompanyNames` ao consultar os nomes disponíveis.

⚠️ **Atenção: Requisito de Correspondência Exata**\
Este é o ponto mais importante do processo. Para que a atualização seja bem-sucedida, o valor enviado no campo `companyName` deve ser uma cópia exata e idêntica a um dos nomes que o Asaas retornou para você.

Qualquer diferença resultará em falha na atualização. Isso inclui:

* Diferenças de maiúsculas/minúsculas.
* Acentuação.
* Espaçamento extra.
* Abreviações ou qualquer outra variação que não conste no registro oficial.

**Não é permitido informar um nome customizado ou que não tenha sido previamente retornado pela consulta**. Este mecanismo garante a integridade e a conformidade dos dados cadastrais na nossa plataforma.