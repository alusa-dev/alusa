# Onboarding e envio de documentos via link

Utilizando um processo de onboarding mais fácil.

Após ter a conta criada, é necessário enviar os documentos para que ela seja aprovada, neste fluxo você irá entender como enviar seu cliente para uma URL do Asaas para continuar seu onboarding.

O envio via link é a forma mais fácil de fazer o onboarding dos seus clientes. Seguindo esse fluxo, para cada documento será gerado um link único, sem que apareça a logo do Asaas, onde o cliente poderá anexar seu documento e também fazer o fluxo de selfie para reconhecimento facial.

O processo se resume nos seguintes passos:

* [Criação da conta Asaas com Webhooks sendo configurados](https://docs.asaas.com/docs/criacao-de-subcontas)
* [Envio da documentação da conta](https://docs.asaas.com/docs/onboarding-e-envio-de-documentos-via-link)
* [Consultar situação cadastral da conta](https://docs.asaas.com/docs/onboarding-e-envio-de-documentos-via-link#consultar-situa%C3%A7%C3%A3o-cadastral-da-conta)

> 🚧 Lembre-se:
>
> O formato White Label precisa estar previamente alinhado e implantado pelo seu gerente de contas. A criação de contas Asaas usando os métodos listados abaixo sem uma definição prévia do funcionamento no formato White Label resultará na criação de subcontas fora dessa estrutura.
>
> Em Sandbox, para fazer o teste, basta [entrar em contato com o Suporte](https://docs.asaas.com/docs/entre-em-contato) e solicitar a liberação.

## Envio da documentação da conta

Para análise da conta, será necessário realizar o envio da documentação. Com o upload dos documentos, a conta entrará em análise a ser realizada dentro de até 48 horas.

Para contas PF, MEI, LTDA ou Individual, é preciso enviar documento de identificação (RG, CPF ou CNPJ),e selfie do titular/sócio administrador. O onboarding será realizado através de um link externo, cuja URL será devolvida no atributo `onboardingUrl` dentro do ID respectivo.

A URL retornada usa o domínio `https://cadastro.io/` e não mostra a logo do Asaas em nenhum momento, tudo é feito de forma transparente para o usuário.

<Image alt="Exemplo de layout da página de envio de documentos via link" align="center" src="https://files.readme.io/b8f95ff-image_8.png">
  Exemplo de layout da página de envio de documentos via link
</Image>

Para contas de Associação, será necessário além do onboarding externo, o [envio via API](https://docs.asaas.com/reference/enviar-documentos) de documentos adicionais, que poderão ser consultados no endpoint.

> 📘
>
> Se um dos documentos enviados no link externo for reprovado, um novo link será gerado.
>
> * Dependendo das condições da análise, é possível que novos documentos adicionais sejam solicitados pelo Asaas. Nesse caso, serão abertos grupos de documentos com o `type` *CUSTOM* e sua descrição no atributo `description`.

A situação da análise dos documentos e da aprovação geral do cadastro poderá ser acompanhada através dos Webhooks de Situação da Conta.

> **GET`/v3/myAccount/documents`**\
> [Confira a referência completa deste endpoint](https://docs.asaas.com/reference/verificar-documentos-pendentes)

> 🚧 Atenção
>
> **Após criar uma subconta, defina um time out de 15 segundos antes de realizar a chamada pra este endpoint.**
>
> Caso a chamada para verificar os documentos subsequentes seja feita em sequência a criação da conta, você provavelmente será informado de que documentos não obrigatórios sejam enviados pois a criação e validação da conta com a receita federal ainda não foi concluída.
>
> O tempo é necessário apenas para a validação, captação de dados necessários e criação da conta.

Essa consulta lhe retornará uma Array com a relação de documentos necessários para aprovação da sua conta Asaas e os seus respectivos links para envio através do campo `onboardingUrl`.

Tendo eles em mão, basta redirecionar seu cliente até o link para que ele faça o envio dos documentos.

#### Enviando documentos que não possuem `onboardingUrl`

Cada grupo de documento possui um `id` específico, que deverá ser utilizado na API de "Enviar documento" para subir o documento respectivo caso não seja via onboading externo. Você pode enviar mais de um documento por grupo de documentos.

> **POST`/v3/myAccount/documents/{id}`**\
> [Confira a referência completa deste endpoint](https://docs.asaas.com/reference/enviar-documentos)/

```json
{  
    "documentFile": [<file>],  
    "type": "IDENTIFICATION",  
}
```

> 📘
>
> Após o envio do documento, esse documento vai ter um `id` especifico para ele e através desse `id` que você pode remover o documento enviado (e não pelo `id` do grupo de documento).

#### Exemplo de retorno do `GET` de que você enviou todos os documentos

Após enviar todos os documentos, a resposta deverá retornar da seguinte forma:

```json
{
    "rejectReasons": null,
    "data": [
        {
            "id": "172ed152-4fa4-43ad-9b69-39c323e9526c",
            "status": "PENDING",
            "type": "MINUTES_OF_ELECTION",
            "title": "Ata de eleição da última diretoria",
            "description": "Não possui descrição",
            "responsible": {
                "name": null,
                "type": "ASSOCIATION"
            },
            "documents": [
                {
                    "id": "d6a55791-7b8b-4014-8457-a453c6e5afd5",
                    "status": "PENDING"
                }
            ]
        },
        {
            "id": "da90162b-61ea-48a1-bf73-4638e079043a",
            "status": "PENDING",
            "type": "IDENTIFICATION",
            "title": "Documentos de identificação",
            "description": "Serão aceitos RG ou CNH.",
            "responsible": {
                "name": "presidente",
                "type": "DIRECTOR"
            },
            "documents": [
                {
                    "id": "eb879e06-5fae-44e9-a88d-c5a428945dec",
                    "status": "PENDING"
                },
                {
                    "id": "88eaed70-bea6-45ff-ad99-dbea9469f725",
                    "status": "PENDING"
                }
            ]
        },
        {
            "id": "da90162b-61ea-48a1-bf73-4638e079043a",
            "status": "PENDING",
            "type": "IDENTIFICATION_SELFIE",
            "title": "Selfie de identificação",
            "description": "Selfie do Diretor",
            "responsible": {
                "name": "presidente",
                "type": "DIRECTOR"
            },
            "documents": [
                {
                    "id": "0f059fe4-7c7b-4dac-b936-41e9430b380a",
                    "status": "PENDING"
                }
            ]
        }
    ]
}
```

#### Outros endpoints disponíveis

**Visualizar documento enviado**

> **GET`/v3/myAccount/documents/files/{id}`**\
> [Confira a referência completa deste endpoint](https://docs.asaas.com/reference/visualizar-documento-enviado)

**Atualizar documento enviado**

> **POST`/v3/myAccount/documents/files/{id}`**\
> [Confira a referência completa deste endpoint](https://docs.asaas.com/reference/atualizar-documento-enviado)

**Remover documento enviado**

> **DELETE`/v3/myAccount/documents/files/{id}`**\
> [Confira a referência completa deste endpoint](https://docs.asaas.com/reference/remover-documento-enviado)

## Consultar situação cadastral da Conta

Caso os webhooks de atualização de situação cadastral não tenham sido implementados e/ou você queira realizar a consulta individualmente, ela poderá ser feita requisitando o endpoint abaixo.

> **GET`/v3/myAccount/status`**\
> [Confira a referência completa deste endpoint](https://docs.asaas.com/reference/consultar-situacao-cadastral-da-conta)

```json
{
  "id": "afb621a5-9030-4b4d-88e8-5b80306d13350",
  "commercialInfo": "AWAITING_APPROVAL",
  "bankAccountInfo": "APPROVED",
  "documentation": "APPROVED",
  "general": "APPROVED"
}
```

Os valores possíveis são:

**Dados comerciais (`commercialInfo`):**

* `REJECTED` - Rejeitado
* `APPROVED` - Aprovado
* `AWAITING_APPROVAL` - Os dados comerciais podem ficar nesse status quando necessitam de alguma aprovação manual, portanto estarão na fila de análise.
* `PENDING` - Os dados comerciais ficam nesta situação quando ainda não estão totalmente preenchidos, por exemplo no onboarding, onde o preenchimento ocorre em etapas.

**Dados da conta bancária (`bankAccountInfo`):**

* `PENDING` - Dados ainda não foram enviados
* `APPROVED` - Aprovado
* `REJECTED` - Rejeitado

**Documentação (`documentation`):**

* `PENDING` - Documentação ainda não foi enviada
* `APPROVED` - Aprovada
* `REJECTED` - Rejeitada
* `AWAITING_APPROVAL` - Quando todos os documentos solicitados são enviados, e não foi possível realizar uma aprovação automática será utilizado este status e também estarão na fila de analise.

**Aprovação geral (`general`):**

* `PENDING` - A aprovação geral estará neste status se os dados comerciais ou a documentação estiverem em `PENDING`, `AWAITING_APPROVAL`, `REJECTED`
* `APPROVED` - Conta aprovada
* `REJECTED` - Conta reprovada
* `AWAITING_APPROVA` - É o status utilizado quando a conta está com todos os outros status aprovados, e a aprovação geral não pôde ser feita automaticamente. Estará na fila aguardando uma análise manual.

> 📘
>
> A conta estará 100% aprovada quando o retorno do atributo `general` for *`APPROVED`*.

## Atualizando dados comerciais

Em alguns casos os dados comerciais podem estar inconsistentes e você precisa atualizá-los, é possível fazer isso através do endpoint de atualizar dados comerciais da conta.

> **POST`/v3/myAccount/commercialInfo`**\
> [Confira a referência completa deste endpoint](https://docs.asaas.com/reference/atualizar-dados-comerciais)

```json
{
    "personType": "JURIDICA",
    "cpfCnpj": "66625514000140",
    "birthDate": null,
    "companyType": "MEI",
    "email": "emaildaempresa@gmail.com",
    "phone": "11 32300606",
    "mobilePhone": "11 988451155",
    "postalCode": "89223005",
    "address": "Av. Rolf Wiest",
    "addressNumber": "659",
    "complement": "Sala 201",
    "province": "Bom Retiro",
}
```

Após a atualização uma nova análise será realizada.

## Prova de vida

A prova de vida é quando o Asaas confirma que a pessoa que está usando a conta é uma pessoa real e libera o uso de todos os produtos. Inicialmente a conta só estará habilitada para criar cobranças e realizar transferências.

No fluxo de envio de documentos via link, a prova de vida acontece com o processo de envio de uma Selfie e a aprovação, em 90% dos casos, acontece em até 5 minutos.