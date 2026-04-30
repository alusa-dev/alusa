# Confirmação Anual de Dados Comerciais para Subcontas

# O que é?

A Confirmação Anual de Dados Comerciais é um processo obrigatório onde os dados cadastrais de uma conta precisam ser **confirmados ou atualizados anualmente**. Este procedimento visa manter a base de dados do Asaas sempre atualizada, conforme as exigências regulatórias.

# Por que preciso confirmar os dados comerciais da subconta?

Esta é uma exigência do **Banco Central do Brasil (Bacen)**. Como Instituição de Pagamento regulamentada, o Asaas deve garantir que os dados cadastrais de todas as contas, incluindo subcontas, estejam sempre precisos e atualizados. A ausência dessa confirmação pode resultar em restrições de uso da API para a subconta afetada.

# Como vai funcionar?

O processo pode ser gerenciado por meio de notificações via Webhook e requer uma ação da sua integração para atualizar os dados da conta quando necessário. Além disso, as informações sobre a expiração dos dados comerciais já são retornadas em algumas rotas de gestão de contas.

As subcontas criadas antes da data (12/06/2025) de implementação desta mudança e que tinham expiração agendada para este ano de 2025 terão a data de expiração dos dados comerciais automaticamente definidas para a última semana de novembro de 2025 pelo Asaas.

Subcontas criadas a partir da data de implementação desta funcionalidade já seguirão o ciclo de expiração anual padrão (um ano após a criação/última atualização).

Essa abordagem visa **evitar a necessidade de um esforço imediato de atualização em massa para toda a sua base de subcontas existente**, permitindo uma adaptação gradual ao novo requisito.

# Verificação Proativa

Ao [criar uma subconta](https://docs.asaas.com/reference/criar-subconta), [recuperar os dados comerciais](https://docs.asaas.com/reference/recuperar-dados-comerciais) de uma conta ou ao [atualizar os dados comerciais](https://docs.asaas.com/reference/atualizar-dados-comerciais), a resposta da API já inclui o objeto `commercialInfoExpiration`. Este objeto contém os campos:

* **`isExpired`** (boolean): Indica se os dados comerciais estão expirados.
* **`scheduledDate`** (string): Indica a data programada para a expiração dos dados comerciais (ex: "2025-05-05 00:00:00").\
  Você pode usar essa informação para se antecipar e programar a atualização antes mesmo do envio do webhook de aviso.

> 📘 Nota sobre Rate Limits:
>
> Lembre-se que a atualização é anual. Verificações proativas excessivas neste campo podem sobrecarregar sua cota de requisições à API (rate limit). Priorize o uso dos webhooks e, se fizer consultas proativas, faça-as com baixa frequência, ciente de que a data de expiração só muda anualmente ou após uma atualização.

# Webhooks

Os seguintes eventos foram adicionados ao escopo de `ACCOUNT_STATUS`:

* `ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON` - Indica que os dados comerciais da conta estão próximos da data de expiração e precisam ser confirmados/atualizados.
* `ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED` - Indica que os dados comerciais da conta expiraram e não foram confirmados. Ações na API para esta conta serão restringidas.

## Notificação prévia

Mesmo com a disponibilidade desses dados na API, 40 dias antes da data limite (`scheduledDate`) para confirmação dos dados, um evento de Webhook `ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON` será enviado para a URL configurada. Indicando que os dados comerciais estão próximos de expirar, sendo necessário confirmar ou atualizar.

## Notificação de Expiração e Bloqueio

Caso os dados comerciais não sejam confirmados até a `scheduledDate`, um novo Webhook com o evento `ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED` será enviado.

> 🚧 Importante:
>
> Ao tentar realizar chamadas para qualquer endpoint da API que esteja bloqueado devido à expiração dos dados comerciais (ou seja, qualquer endpoint diferente dos listados abaixo como acessíveis), **sua integração receberá como resposta o código de status HTTP 403 Forbidden**. O corpo da resposta de erro incluirá uma mensagem indicando que a ação não pode ser completada devido à pendência na confirmação/atualização dos dados comerciais e a necessidade de regularizá-los para restaurar o acesso.

Para permitir a regularização da pendência, os seguintes endpoints permanecerão acessíveis para a conta, mesmo durante o período de bloqueio:

> **POST** `/v3/myAccount/commercialInfo/` (para atualizar os dados)\
> **GET** `/v3/myAccount/commercialInfo/` (para consultar os dados atuais)

Após a atualização dos dados comerciais, o acesso às demais funcionalidades da API é restabelecido, `isExpired` voltará para `false` e uma nova scheduledDate é definida.

### Exemplos dos Eventos de Webhook

**Dados Comerciais Próximos da Expiração:**

```json
{
   "id":"evt_05b708f961d739ea7eba7e4db318f621&368604920",
   "event":"ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON",
   "dateCreated":"2024-05-10 16:45:03",
   "accountStatus":{
      "id":"175027c1-029c-41e5-8b9a-e289b9788c33",
      "commercialInfo":"APPROVED",
      "bankAccountInfo":"APPROVED",
      "documentation":"APPROVED",
      "general":"APPROVED"
   },
   "additionalInfo":{
      "scheduledDate":"2025-06-20"
   }
}
```

<br />

**Dados Comerciais Expirados:**

```json
{  
   "id":"evt_05b708f961d739ea7eba7e4db318f621&368604920",  
   "event":"ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED",  
   "dateCreated":"2024-05-10 02:00:00",  
   "accountStatus":{  
      "id":"175027c1-029c-41e5-8b9a-e289b9788c33",  
      "commercialInfo":"APPROVED",  
      "bankAccountInfo":"APPROVED",  
      "documentation":"APPROVED",  
      "general":"APPROVED"  
   },  
   "additionalInfo":{  
      "scheduledDate":"2025-05-10"  
   }  
}
```

> 🚧 Importante:
>
> Mesmo quando o evento `ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED` é disparado, os campos `commercialInfo` e `general` dentro do objeto `accountStatus` (conforme exemplificado acima) podem continuar com o valor **`APPROVED`**.

Isso ocorre porque a expiração dos dados comerciais para fins de confirmação anual é um processo específico de conformidade e não reflete, necessariamente, uma reprovação do cadastro comercial geral da conta ou de seu status geral de aprovação (que podem ser gerenciados por fluxos de análise distintos e permanecerem válidos). O bloqueio de funcionalidades da API é uma medida operacional para garantir a atualização dos dados.

O indicativo de que os dados comerciais de fato precisam de atualização será o próprio evento `ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED` e, nas chamadas de API subsequentes para consultar os dados da conta, o campo **`isExpired`** (dentro do objeto **`commercialInfoExpiration`**) estará como **`true`**.

# Boas práticas

Como uma boa prática, recomendamos que sua plataforma obtenha os dados comerciais atualizados ou a confirmação da validade dos dados existentes no Asaas diretamente com o titular da subconta. Após obter essa confirmação, sua integração deve submeter esses dados ao Asaas.

* Para obter os dados comerciais e apresentar ao dono da subconta, utilize o endpoint:

> **GET** `/v3/myAccount/commercialInfo/`
>
> Confira a [referencia completa](https://docs.asaas.com/reference/recuperar-dados-comerciais) do endpoint.

* Para confirmar ou atualizar os dados comerciais da subconta, utilize o endpoint:

> **POST** `/v3/myAccount/commercialInfo/`
>
> Confira a [referencia completa](https://docs.asaas.com/reference/atualizar-dados-comerciais) do endpoint.

> 🚧 Importante:
>
> Lembre-se que este endpoint deve ser chamado no contexto da subconta, ou seja, utilizando a `access_token` da subconta específica.

> 📘 Atenção
>
> Ao realizar a atualização com sucesso, uma nova `scheduledDate` será definida no objeto `commercialInfoExpiration` (retornado na resposta e em consultas futuras) para um ano à frente, e o acesso às funcionalidades da API para aquela subconta permanecerá normal.