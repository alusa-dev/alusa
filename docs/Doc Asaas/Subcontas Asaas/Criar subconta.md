# Criar subconta

### Guia de Subcontas

[Confira o guia de subcontas para mais informações.](https://docs.asaas.com/docs/criacao-de-subcontas)

O objeto de retorno da API conterá a chave de API da subconta criada (`apiKey`) além do `walletId` para Split de Cobranças ou Transferências.

A chave de API (`apiKey`) será devolvida uma única vez, na resposta da chamada de criação da subconta Asaas, portanto, assegure-se de gravar a informação nesse momento. Caso não tenha realizado o armazenamento, entre em contato com nosso Suporte Técnico.

> 🚧 Importante
>
> Em Sandbox só é possível criar 20 subcontas por dia, caso a conta atinja o limite diário receberá uma notificação de erro.
>
> Além disso, todas as comunicações de subcontas em Sandbox serão enviadas para o e-mail da conta raiz. O dono da subconta recebe notificações.

> 🚧 Informe sempre um CEP válido
>
> O `postalCode` informado precisa ser válido, pois fazemos o cadastro da cidade através dele. Caso não seja localizado, será retornado um erro `400` avisando que a cidade precisa ser informada

> ❗️ Atenção
>
> O envio da renda (PF) ou faturamento mensal (PJ) através do campo `incomeValue` nos endpoints de Atualização de Dados Comerciais (`/v3/myAccount/commercialInfo`) e Criação de Subcontas (`/v3/accounts`) é obrigatório.

> ❗️ Atenção - Manutenção Cadastral Anual Obrigatória
>
> Lembre-se que, anualmente, os dados comerciais da subconta (como telefone, e-mail, endereço, renda/faturamento e atividade) precisarão ser confirmados ou atualizados. Este é um requisito regulatório. Veja detalhes completos na seção **[Confirmação Anual de Dados Comerciais para Subcontas](https://docs.asaas.com/docs/confirma%C3%A7%C3%A3o-anual-de-dados-comerciais-para-subcontas)** em nosso Guia.

# OpenAPI definition

```json
{
  "openapi": "3.0.1",
  "info": {
    "title": "Asaas",
    "description": "API pública de integração com a plataforma Asaas.",
    "version": "3.0.0"
  },
  "servers": [
    {
      "url": "https://api-sandbox.asaas.com",
      "description": "Sandbox"
    }
  ],
  "security": [
    {
      "Authorization": []
    }
  ],
  "tags": [
    {
      "name": "Subcontas Asaas"
    }
  ],
  "paths": {
    "/v3/accounts": {
      "post": {
        "tags": [
          "Subcontas Asaas"
        ],
        "summary": "Criar subconta",
        "description": "",
        "operationId": "criar-subconta",
        "parameters": [],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "name",
                  "email",
                  "cpfCnpj",
                  "mobilePhone",
                  "incomeValue",
                  "address",
                  "addressNumber",
                  "province",
                  "postalCode"
                ],
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "Nome da subconta",
                    "nullable": false,
                    "example": "John Doe",
                    "deprecated": false
                  },
                  "email": {
                    "type": "string",
                    "description": "Email da subconta",
                    "nullable": false,
                    "example": "john.doe@asaas.com.br",
                    "deprecated": false
                  },
                  "loginEmail": {
                    "type": "string",
                    "description": "Email para login da subconta, caso não informado será utilizado o email da subconta",
                    "example": "johndoe@asaas.com.br",
                    "deprecated": false
                  },
                  "cpfCnpj": {
                    "type": "string",
                    "description": "CPF ou CNPJ do proprietário da subconta",
                    "nullable": false,
                    "example": "35381637000150",
                    "deprecated": false
                  },
                  "birthDate": {
                    "type": "string",
                    "description": "Data de nascimento (somente quando Pessoa Física)",
                    "format": "date",
                    "example": "1995-04-12",
                    "deprecated": false
                  },
                  "companyType": {
                    "type": "string",
                    "description": "Tipo da empresa (somente quando Pessoa Jurídica)",
                    "example": "MEI",
                    "deprecated": false,
                    "enum": [
                      "MEI",
                      "LIMITED",
                      "INDIVIDUAL",
                      "ASSOCIATION"
                    ],
                    "x-readme-ref-name": "AccountSaveRequestCompanyType"
                  },
                  "phone": {
                    "type": "string",
                    "description": "Telefone Fixo",
                    "deprecated": false,
                    "example": null
                  },
                  "mobilePhone": {
                    "type": "string",
                    "description": "Telefone Celular",
                    "nullable": false,
                    "deprecated": false,
                    "example": null
                  },
                  "site": {
                    "type": "string",
                    "description": "URL of the subbacount website",
                    "example": "https://www.example.com",
                    "deprecated": false
                  },
                  "incomeValue": {
                    "type": "number",
                    "description": "Faturamento/Renda mensal",
                    "nullable": false,
                    "example": 25000,
                    "deprecated": false
                  },
                  "address": {
                    "type": "string",
                    "description": "Logradouro",
                    "nullable": false,
                    "example": "Rua Fernando Orlandi",
                    "deprecated": false
                  },
                  "addressNumber": {
                    "type": "string",
                    "description": "Número do endereço",
                    "nullable": false,
                    "example": "544",
                    "deprecated": false
                  },
                  "complement": {
                    "type": "string",
                    "description": "Complemento do endereço",
                    "deprecated": false,
                    "example": null
                  },
                  "province": {
                    "type": "string",
                    "description": "Bairro",
                    "nullable": false,
                    "example": "Jardim Pedra Branca",
                    "deprecated": false
                  },
                  "postalCode": {
                    "type": "string",
                    "description": "CEP do endereço",
                    "nullable": false,
                    "example": "14079-452",
                    "deprecated": false
                  },
                  "webhooks": {
                    "type": "array",
                    "description": "Array com as configurações de Webhooks desejadas",
                    "deprecated": false,
                    "items": {
                      "type": "object",
                      "properties": {
                        "name": {
                          "type": "string",
                          "description": "Nome do Webhook",
                          "example": "Nome exemplo",
                          "deprecated": false
                        },
                        "url": {
                          "type": "string",
                          "description": "URL de destino dos eventos",
                          "example": "https://www.example.com/webhook/asaas",
                          "deprecated": false
                        },
                        "email": {
                          "type": "string",
                          "description": "E-mail que receberá notificações sobre o Webhook",
                          "example": "john.doe@asaas.com.br",
                          "deprecated": false
                        },
                        "enabled": {
                          "type": "boolean",
                          "description": "Definir se o Webhook está ativo",
                          "example": true,
                          "deprecated": false
                        },
                        "interrupted": {
                          "type": "boolean",
                          "description": "Definir se a fila de sincronização está interrompida",
                          "example": false,
                          "deprecated": false
                        },
                        "apiVersion": {
                          "type": "integer",
                          "description": "Versão da API",
                          "format": "int32",
                          "example": 3,
                          "deprecated": false
                        },
                        "authToken": {
                          "type": "string",
                          "description": "Token de autenticação do Webhook",
                          "example": "5tLxsL6uoN",
                          "deprecated": false
                        },
                        "sendType": {
                          "type": "string",
                          "description": "Sequencial (SEQUENTIALLY) ou não sequencial (NON_SEQUENTIALLY)",
                          "example": "SEQUENTIALLY",
                          "deprecated": false,
                          "enum": [
                            "NON_SEQUENTIALLY",
                            "SEQUENTIALLY"
                          ],
                          "x-readme-ref-name": "WebhookConfigSaveRequestWebhookSendType"
                        },
                        "events": {
                          "type": "array",
                          "description": "Lista de eventos enviados pelo Webhook",
                          "example": [
                            "PAYMENT_RECEIVED",
                            "PAYMENT_CONFIRMED"
                          ],
                          "deprecated": false,
                          "items": {
                            "type": "string",
                            "description": "Lista de eventos enviados pelo Webhook",
                            "example": [
                              "PAYMENT_RECEIVED",
                              "PAYMENT_CONFIRMED"
                            ],
                            "deprecated": false,
                            "enum": [
                              "PAYMENT_AUTHORIZED",
                              "PAYMENT_AWAITING_RISK_ANALYSIS",
                              "PAYMENT_APPROVED_BY_RISK_ANALYSIS",
                              "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
                              "PAYMENT_CREATED",
                              "PAYMENT_UPDATED",
                              "PAYMENT_CONFIRMED",
                              "PAYMENT_RECEIVED",
                              "PAYMENT_ANTICIPATED",
                              "PAYMENT_OVERDUE",
                              "PAYMENT_DELETED",
                              "PAYMENT_RESTORED",
                              "PAYMENT_REFUNDED",
                              "PAYMENT_REFUND_IN_PROGRESS",
                              "PAYMENT_REFUND_DENIED",
                              "PAYMENT_RECEIVED_IN_CASH_UNDONE",
                              "PAYMENT_CHARGEBACK_REQUESTED",
                              "PAYMENT_CHARGEBACK_DISPUTE",
                              "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
                              "PAYMENT_DUNNING_RECEIVED",
                              "PAYMENT_DUNNING_REQUESTED",
                              "PAYMENT_BANK_SLIP_VIEWED",
                              "PAYMENT_CHECKOUT_VIEWED",
                              "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
                              "PAYMENT_PARTIALLY_REFUNDED",
                              "PAYMENT_SPLIT_CANCELLED",
                              "PAYMENT_SPLIT_DIVERGENCE_BLOCK",
                              "PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED",
                              "INVOICE_CREATED",
                              "INVOICE_UPDATED",
                              "INVOICE_SYNCHRONIZED",
                              "INVOICE_AUTHORIZED",
                              "INVOICE_PROCESSING_CANCELLATION",
                              "INVOICE_CANCELED",
                              "INVOICE_CANCELLATION_DENIED",
                              "INVOICE_ERROR",
                              "TRANSFER_CREATED",
                              "TRANSFER_PENDING",
                              "TRANSFER_IN_BANK_PROCESSING",
                              "TRANSFER_BLOCKED",
                              "TRANSFER_DONE",
                              "TRANSFER_FAILED",
                              "TRANSFER_CANCELLED",
                              "BILL_CREATED",
                              "BILL_PENDING",
                              "BILL_BANK_PROCESSING",
                              "BILL_PAID",
                              "BILL_CANCELLED",
                              "BILL_FAILED",
                              "BILL_REFUNDED",
                              "RECEIVABLE_ANTICIPATION_CANCELLED",
                              "RECEIVABLE_ANTICIPATION_SCHEDULED",
                              "RECEIVABLE_ANTICIPATION_PENDING",
                              "RECEIVABLE_ANTICIPATION_CREDITED",
                              "RECEIVABLE_ANTICIPATION_DEBITED",
                              "RECEIVABLE_ANTICIPATION_DENIED",
                              "RECEIVABLE_ANTICIPATION_OVERDUE",
                              "MOBILE_PHONE_RECHARGE_PENDING",
                              "MOBILE_PHONE_RECHARGE_CANCELLED",
                              "MOBILE_PHONE_RECHARGE_CONFIRMED",
                              "MOBILE_PHONE_RECHARGE_REFUNDED",
                              "ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED",
                              "ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL",
                              "ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING",
                              "ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED",
                              "ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED",
                              "ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL",
                              "ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED",
                              "ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON",
                              "ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING",
                              "ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED",
                              "ACCOUNT_STATUS_DOCUMENT_APPROVED",
                              "ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL",
                              "ACCOUNT_STATUS_DOCUMENT_PENDING",
                              "ACCOUNT_STATUS_DOCUMENT_REJECTED",
                              "ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED",
                              "ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL",
                              "ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING",
                              "ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED",
                              "SUBSCRIPTION_CREATED",
                              "SUBSCRIPTION_UPDATED",
                              "SUBSCRIPTION_INACTIVATED",
                              "SUBSCRIPTION_DELETED",
                              "SUBSCRIPTION_SPLIT_DISABLED",
                              "SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK",
                              "SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED",
                              "CHECKOUT_CREATED",
                              "CHECKOUT_CANCELED",
                              "CHECKOUT_EXPIRED",
                              "CHECKOUT_PAID",
                              "BALANCE_VALUE_BLOCKED",
                              "BALANCE_VALUE_UNBLOCKED",
                              "INTERNAL_TRANSFER_CREDIT",
                              "INTERNAL_TRANSFER_DEBIT",
                              "ACCESS_TOKEN_CREATED",
                              "ACCESS_TOKEN_DELETED",
                              "ACCESS_TOKEN_DISABLED",
                              "ACCESS_TOKEN_ENABLED",
                              "ACCESS_TOKEN_EXPIRED",
                              "ACCESS_TOKEN_EXPIRING_SOON"
                            ],
                            "x-readme-ref-name": "WebhookConfigSaveRequestWebhookEvent"
                          },
                          "enum": [
                            "PAYMENT_AUTHORIZED",
                            "PAYMENT_AWAITING_RISK_ANALYSIS",
                            "PAYMENT_APPROVED_BY_RISK_ANALYSIS",
                            "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
                            "PAYMENT_CREATED",
                            "PAYMENT_UPDATED",
                            "PAYMENT_CONFIRMED",
                            "PAYMENT_RECEIVED",
                            "PAYMENT_ANTICIPATED",
                            "PAYMENT_OVERDUE",
                            "PAYMENT_DELETED",
                            "PAYMENT_RESTORED",
                            "PAYMENT_REFUNDED",
                            "PAYMENT_REFUND_IN_PROGRESS",
                            "PAYMENT_REFUND_DENIED",
                            "PAYMENT_RECEIVED_IN_CASH_UNDONE",
                            "PAYMENT_CHARGEBACK_REQUESTED",
                            "PAYMENT_CHARGEBACK_DISPUTE",
                            "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
                            "PAYMENT_DUNNING_RECEIVED",
                            "PAYMENT_DUNNING_REQUESTED",
                            "PAYMENT_BANK_SLIP_VIEWED",
                            "PAYMENT_CHECKOUT_VIEWED",
                            "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
                            "PAYMENT_PARTIALLY_REFUNDED",
                            "PAYMENT_SPLIT_CANCELLED",
                            "PAYMENT_SPLIT_DIVERGENCE_BLOCK",
                            "PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED",
                            "INVOICE_CREATED",
                            "INVOICE_UPDATED",
                            "INVOICE_SYNCHRONIZED",
                            "INVOICE_AUTHORIZED",
                            "INVOICE_PROCESSING_CANCELLATION",
                            "INVOICE_CANCELED",
                            "INVOICE_CANCELLATION_DENIED",
                            "INVOICE_ERROR",
                            "TRANSFER_CREATED",
                            "TRANSFER_PENDING",
                            "TRANSFER_IN_BANK_PROCESSING",
                            "TRANSFER_BLOCKED",
                            "TRANSFER_DONE",
                            "TRANSFER_FAILED",
                            "TRANSFER_CANCELLED",
                            "BILL_CREATED",
                            "BILL_PENDING",
                            "BILL_BANK_PROCESSING",
                            "BILL_PAID",
                            "BILL_CANCELLED",
                            "BILL_FAILED",
                            "BILL_REFUNDED",
                            "RECEIVABLE_ANTICIPATION_CANCELLED",
                            "RECEIVABLE_ANTICIPATION_SCHEDULED",
                            "RECEIVABLE_ANTICIPATION_PENDING",
                            "RECEIVABLE_ANTICIPATION_CREDITED",
                            "RECEIVABLE_ANTICIPATION_DEBITED",
                            "RECEIVABLE_ANTICIPATION_DENIED",
                            "RECEIVABLE_ANTICIPATION_OVERDUE",
                            "MOBILE_PHONE_RECHARGE_PENDING",
                            "MOBILE_PHONE_RECHARGE_CANCELLED",
                            "MOBILE_PHONE_RECHARGE_CONFIRMED",
                            "MOBILE_PHONE_RECHARGE_REFUNDED",
                            "ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED",
                            "ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL",
                            "ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING",
                            "ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED",
                            "ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED",
                            "ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL",
                            "ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED",
                            "ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON",
                            "ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING",
                            "ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED",
                            "ACCOUNT_STATUS_DOCUMENT_APPROVED",
                            "ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL",
                            "ACCOUNT_STATUS_DOCUMENT_PENDING",
                            "ACCOUNT_STATUS_DOCUMENT_REJECTED",
                            "ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED",
                            "ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL",
                            "ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING",
                            "ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED",
                            "SUBSCRIPTION_CREATED",
                            "SUBSCRIPTION_UPDATED",
                            "SUBSCRIPTION_INACTIVATED",
                            "SUBSCRIPTION_DELETED",
                            "SUBSCRIPTION_SPLIT_DISABLED",
                            "SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK",
                            "SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED",
                            "CHECKOUT_CREATED",
                            "CHECKOUT_CANCELED",
                            "CHECKOUT_EXPIRED",
                            "CHECKOUT_PAID",
                            "BALANCE_VALUE_BLOCKED",
                            "BALANCE_VALUE_UNBLOCKED",
                            "INTERNAL_TRANSFER_CREDIT",
                            "INTERNAL_TRANSFER_DEBIT",
                            "ACCESS_TOKEN_CREATED",
                            "ACCESS_TOKEN_DELETED",
                            "ACCESS_TOKEN_DISABLED",
                            "ACCESS_TOKEN_ENABLED",
                            "ACCESS_TOKEN_EXPIRED",
                            "ACCESS_TOKEN_EXPIRING_SOON"
                          ]
                        }
                      },
                      "description": "Array com as configurações de Webhooks desejadas",
                      "deprecated": false,
                      "x-readme-ref-name": "WebhookConfigSaveRequestDTO"
                    }
                  }
                },
                "x-readme-ref-name": "AccountSaveRequestDTO"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "object": {
                      "type": "string",
                      "description": "Tipo de objeto",
                      "example": "account",
                      "deprecated": false
                    },
                    "id": {
                      "type": "string",
                      "description": "Identificador único da subconta no Asaas",
                      "example": "4f468235-cec3-482f-b3d0-348af4c7194",
                      "deprecated": false
                    },
                    "name": {
                      "type": "string",
                      "description": "Nome da subconta",
                      "example": "John Doe",
                      "deprecated": false
                    },
                    "email": {
                      "type": "string",
                      "description": "Email da subconta",
                      "example": "john.doe@asaas.com.br",
                      "deprecated": false
                    },
                    "loginEmail": {
                      "type": "string",
                      "description": "Email para login da subconta, caso não informado será utilizado o email da subconta",
                      "example": "john.doe@asaas.com.br",
                      "deprecated": false
                    },
                    "phone": {
                      "type": "string",
                      "description": "Telefone Fixo",
                      "deprecated": false,
                      "example": null
                    },
                    "mobilePhone": {
                      "type": "string",
                      "description": "Telefone Celular",
                      "deprecated": false,
                      "example": null
                    },
                    "address": {
                      "type": "string",
                      "description": "Logradouro",
                      "example": "Rua Fernando Orlandi",
                      "deprecated": false
                    },
                    "addressNumber": {
                      "type": "string",
                      "description": "Número do endereço",
                      "example": "544",
                      "deprecated": false
                    },
                    "complement": {
                      "type": "string",
                      "description": "Complemento do endereço",
                      "deprecated": false,
                      "example": null
                    },
                    "province": {
                      "type": "string",
                      "description": "Bairro",
                      "example": "Jardim Pedra Branca",
                      "deprecated": false
                    },
                    "postalCode": {
                      "type": "string",
                      "description": "CEP do endereço",
                      "example": "14079-452",
                      "deprecated": false
                    },
                    "cpfCnpj": {
                      "type": "string",
                      "description": "CPF ou CNPJ do proprietário da subconta",
                      "example": "35381637000150",
                      "deprecated": false
                    },
                    "birthDate": {
                      "type": "string",
                      "description": "Data de nascimento (somente quando Pessoa Física)",
                      "format": "date",
                      "example": "1995-04-12",
                      "deprecated": false
                    },
                    "personType": {
                      "type": "string",
                      "description": "Tipo de Pessoa",
                      "example": "JURIDICA",
                      "deprecated": false,
                      "enum": [
                        "JURIDICA",
                        "FISICA"
                      ],
                      "x-readme-ref-name": "AccountSaveResponsePersonType"
                    },
                    "companyType": {
                      "type": "string",
                      "description": "Tipo da empresa (somente quando Pessoa Jurídica)",
                      "example": "MEI",
                      "deprecated": false,
                      "enum": [
                        "MEI",
                        "LIMITED",
                        "INDIVIDUAL",
                        "ASSOCIATION"
                      ],
                      "x-readme-ref-name": "AccountSaveResponseCompanyType"
                    },
                    "city": {
                      "type": "integer",
                      "description": "Identificador único da cidade no Asaas",
                      "format": "int32",
                      "example": 15478,
                      "deprecated": false
                    },
                    "state": {
                      "type": "string",
                      "description": "Sigla do Estado (SP, RJ, SC, ...)",
                      "example": "SP",
                      "deprecated": false
                    },
                    "country": {
                      "type": "string",
                      "description": "País (Fixo Brasil)",
                      "example": "Brasil",
                      "deprecated": false
                    },
                    "tradingName": {
                      "type": "string",
                      "description": "Nome de exibição (preenchido automaticamente)",
                      "deprecated": false,
                      "example": null
                    },
                    "site": {
                      "type": "string",
                      "description": "URL of the subbacount website",
                      "example": "https://www.example.com",
                      "deprecated": false
                    },
                    "walletId": {
                      "type": "string",
                      "description": "Unique wallet identifier to split charges or transfer between Asaas accounts",
                      "example": "c0c1688f-636b-42c0-b6ee-7339182276b7",
                      "deprecated": false
                    },
                    "accountNumber": {
                      "type": "object",
                      "properties": {
                        "agency": {
                          "type": "string",
                          "description": "Account agency",
                          "example": "0001",
                          "deprecated": false
                        },
                        "account": {
                          "type": "string",
                          "description": "Account number",
                          "example": "3514",
                          "deprecated": false
                        },
                        "accountDigit": {
                          "type": "string",
                          "description": "Account digit",
                          "example": "3",
                          "deprecated": false
                        }
                      },
                      "description": "Subaccount number in Asaas",
                      "deprecated": false,
                      "x-readme-ref-name": "AccountNumberDTO"
                    },
                    "commercialInfoExpiration": {
                      "type": "object",
                      "properties": {
                        "isExpired": {
                          "type": "boolean",
                          "description": "Informa se os dados comerciais estão expirados",
                          "example": false,
                          "deprecated": false
                        },
                        "scheduledDate": {
                          "type": "string",
                          "description": "Informa a data de expiração dos dados comerciais",
                          "format": "date-time",
                          "example": "2025-05-05 00:00:00",
                          "deprecated": false
                        }
                      },
                      "description": "Informações sobre a expiração dos dados comerciais",
                      "deprecated": false,
                      "x-readme-ref-name": "AccountInfoCommercialInfoExpirationResponseDTO"
                    },
                    "accessToken": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "description": "ID da chave de API",
                          "example": "b6bff0c5-38c6-496a-a3a8-105b31d5bcfe",
                          "deprecated": false
                        },
                        "name": {
                          "type": "string",
                          "description": "Nome da chave de API",
                          "example": "My API Access Token",
                          "deprecated": false
                        },
                        "enabled": {
                          "type": "boolean",
                          "description": "Indica se a chave de API está habilitada",
                          "example": false,
                          "deprecated": false
                        },
                        "expirationDate": {
                          "type": "string",
                          "description": "Data de expiração da chave de API",
                          "format": "date-time",
                          "example": "2026-12-31 12:30:50",
                          "deprecated": false
                        },
                        "dateCreated": {
                          "type": "string",
                          "description": "Data de criação da chave de API",
                          "format": "date-time",
                          "example": "2026-01-01 08:00:00",
                          "deprecated": false
                        },
                        "projectedExpirationDateByLackOfUse": {
                          "type": "string",
                          "description": "Data prevista de expiração por falta de uso da chave de API",
                          "format": "date",
                          "example": "2026-06-01",
                          "deprecated": false
                        }
                      },
                      "x-readme-ref-name": "CustomerApiAccessTokenBaseResponseDTO"
                    },
                    "apiKey": {
                      "type": "string",
                      "description": "Chave de API",
                      "example": "$aact_hmlg_xxxxx",
                      "deprecated": false
                    }
                  },
                  "x-readme-ref-name": "AccountSaveResponseDTO"
                }
              }
            }
          },
          "400": {
            "description": "Bad Request",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "errors": {
                      "type": "array",
                      "description": "Lista de objetos",
                      "deprecated": false,
                      "items": {
                        "type": "object",
                        "properties": {
                          "code": {
                            "type": "string",
                            "description": "Código do erro",
                            "deprecated": false,
                            "example": null
                          },
                          "description": {
                            "type": "string",
                            "description": "Descrição do erro",
                            "deprecated": false,
                            "example": null
                          }
                        },
                        "description": "Lista de objetos",
                        "deprecated": false,
                        "x-readme-ref-name": "ErrorResponseItemDTO"
                      }
                    }
                  },
                  "x-readme-ref-name": "ErrorResponseDTO"
                },
                "example": {
                  "errors": [
                    {
                      "code": "error_code",
                      "description": "Descrição do erro"
                    }
                  ]
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "errors": {
                      "type": "array",
                      "description": "Lista de objetos",
                      "deprecated": false,
                      "items": {
                        "type": "object",
                        "properties": {
                          "code": {
                            "type": "string",
                            "description": "Código do erro",
                            "deprecated": false,
                            "example": null
                          },
                          "description": {
                            "type": "string",
                            "description": "Descrição do erro",
                            "deprecated": false,
                            "example": null
                          }
                        },
                        "description": "Lista de objetos",
                        "deprecated": false,
                        "x-readme-ref-name": "ErrorResponseItemDTO"
                      }
                    }
                  },
                  "x-readme-ref-name": "ErrorResponseDTO"
                },
                "example": {
                  "errors": [
                    {
                      "code": "invalid_access_token",
                      "description": "A chave de API fornecida é inválida"
                    }
                  ]
                }
              }
            }
          }
        },
        "deprecated": false
      }
    }
  },
  "components": {
    "securitySchemes": {
      "Authorization": {
        "type": "apiKey",
        "name": "access_token",
        "in": "header"
      }
    }
  }
}
```