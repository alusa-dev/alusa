# Gerenciamento das chaves de API de subcontas

O Asaas permite que a conta-pai gerencie as chaves de API de suas subcontas através de endpoints específicos. Essa funcionalidade é ideal para parceiros que necessitam recuperar o acesso a subcontas cujas chaves foram perdidas ou expiradas.

## Como habilitar o acesso?

Devido à sensibilidade dessa operação, os endpoints de gerenciamento vêm bloqueados por padrão. Para utilizá-los, é necessário realizar uma liberação temporária através da interface web do Asaas.

1. Acesse o menu Integrações e clique em Chaves de API.
2. Localize a seção Gerenciamento de Chaves de API de Subcontas (visível apenas se você possuir subcontas).
3. Clique em "Habilitar acesso".

<Callout icon="🚧" theme="warn">
  **Atenção**

  * Por questões de segurança, a liberação dos endpoints dura 2 horas. Após esse período, o acesso é revogado automaticamente e, se necessário, você deverá habilitá-lo novamente na interface.
  * Esses endpoints só podem ser acessados por seu sistema e caso você tenha a configuração de Whitelist de IP habilitada. Confira mais detalhes sobre a funcionalidade de [Whitelist de IP](https://docs.asaas.com/docs/mecanismos-de-seguranca#/).
</Callout>

## Utilizando os endpoints

Com o acesso habilitado, você pode realizar as seguintes operações autenticando-se com a chave da conta-pai:

1. Listar chaves de uma subconta
   1. Recupere os IDs e dados das chaves ativas de uma subconta específica.
   2. [Ver referência completa da rota](https://docs.asaas.com/reference/listar-chaves-de-api-de-uma-subconta#/)
2. Criar uma nova chave
   1. Gera uma nova chave de API para a subconta informada.
   2. [Ver referência completa da rota](https://docs.asaas.com/reference/criar-chave-de-api-para-uma-subconta#/)
3. Atualizar ou Excluir uma chave
   1. Para editar configurações ou excluir (revogar) uma chave, você precisará do id da subconta e do accessTokenId(ID da chave), que pode ser obtido na listagem ou no retorno da criação.
   2. Ver referência completa das rotas de [Atualizar](https://docs.asaas.com/reference/atualizar-chave-de-api-de-uma-subconta#/) e [Excluir](https://docs.asaas.com/reference/excluir-chave-de-api-de-uma-subconta#/) chave.

<br />