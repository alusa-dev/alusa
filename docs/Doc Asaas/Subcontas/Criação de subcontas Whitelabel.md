# Criação de subcontas Whitelabel

[Com o White Label habilitado](https://docs.asaas.com/docs/sobre-white-label) seu cliente não terá acesso ao nosso sistema e não receberá nenhum tipo de comunicação por parte do Asaas, cabendo a você nesse caso disponibilizar os recursos desejados de nossa documentação API dentro do seu sistema integrado.

O processo para começar com criação de subcontas em white label se resume nos seguintes passos:

* Solicitação ao seu gerente de contas para liberação desta funcionalidade
* Criação da subconta Asaas com Webhooks sendo configurados
* Envio da Documentação da subconta, pelo [onboarding com envio de documentos via link](https://docs.asaas.com/docs/onboarding-e-envio-de-documentos-via-link)
* Consultar situação cadastral da subconta

<Callout icon="🚧" theme="warn">
  O formato White Label precisa estar previamente alinhado e implantado pelo seu gerente de contas. A criação de contas Asaas usando os métodos listados abaixo sem uma definição prévia do funcionamento no formato White Label resultará na criação de subcontas fora dessa estrutura.

  Em Sandbox, para fazer o teste, basta verificar [aqui nessa sessão como configurar na conta sandbox](https://docs.asaas.com/docs/como-configurar-sua-conta-no-sandbox#/).
</Callout>

## Criação da subconta com Webhooks sendo configurados

> **POST`/v3/accounts`**\
> [Confira a referência completa deste endpoint](https://docs.asaas.com/reference/criar-subconta)

```json
{
    "name": "Subconta criada via API",
    "email": "emaildaempresa@gmail.com",
    "cpfCnpj": "66625514000140",
    "birthDate": "1994-05-16",
    "companyType": "MEI",
    "phone": "11 32300606",
    "mobilePhone": "11 988451155",
    "address": "Av. Rolf Wiest",
    "addressNumber": "277",
    "complement": "Sala 502",
    "province": "Bom Retiro",
    "postalCode": "89223005",
    "webhooks": [
        {
          	"name": "Webhook para cobranças",
            "url": "http://meusite.com/webhook/payments",
            "email": "john.doe@asaas.com.br",
          	"sendType": "SEQUENTIALLY",
            "interrupted": false,
            "enabled": true,
            "apiVersion": 3,
            "authToken": "5tLxsL6uoN",
            "events": ["PAYMENT_CREATED", "PAYMENT_UPDATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]
        }
    ]
}
```

É de suma importância que os Webhooks sejam configurados de início em subcontas Whitelabel para garantir que nenhum evento de criação ou atualização da conta sejam perdidos, evitando também a necessidade de requisições secundárias para configuração desses métodos.

Os detalhes sobre os eventos disponíveis para Webhooks pode ser conferido no [guia de integrações de Webhook](https://docs.asaas.com/docs/sobre-os-webhooks).