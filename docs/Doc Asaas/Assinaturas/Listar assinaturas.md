# Listar assinaturas

Diferente da recuperação de uma assinatura específica, este método retorna uma lista paginada com todas as assinaturas para os filtros informados.

Listar assinaturas de um cliente específico: `GET https://api.asaas.com/v3/subscriptions?customer={customer_id}`

Filtrar por forma de pagamento: `GET https://api.asaas.com/v3/subscriptions?billingType=CREDIT_CARD`

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
      "name": "Assinaturas"
    }
  ],
  "paths": {
    "/v3/subscriptions": {
      "get": {
        "tags": [
          "Assinaturas"
        ],
        "summary": "Listar assinaturas",
        "description": "",
        "operationId": "listar-assinaturas",
        "parameters": [
          {
            "name": "offset",
            "in": "query",
            "description": "Elemento inicial da lista",
            "schema": {
              "type": "integer",
              "example": 0
            }
          },
          {
            "name": "limit",
            "in": "query",
            "description": "Número de elementos da lista (max: 100)",
            "schema": {
              "maximum": 100,
              "type": "integer",
              "example": 10
            }
          },
          {
            "name": "customer",
            "in": "query",
            "description": "Filtrar pelo Identificador único do cliente",
            "schema": {
              "type": "string",
              "example": null
            }
          },
          {
            "name": "customerGroupName",
            "in": "query",
            "description": "Filtrar pelo nome do grupo de cliente",
            "schema": {
              "type": "string",
              "example": null
            }
          },
          {
            "name": "billingType",
            "in": "query",
            "description": "Filtrar por forma de pagamento",
            "schema": {
              "type": "string",
              "description": "Filtrar por forma de pagamento",
              "example": "UNDEFINED",
              "deprecated": false,
              "enum": [
                "UNDEFINED",
                "BOLETO",
                "CREDIT_CARD",
                "DEBIT_CARD",
                "TRANSFER",
                "DEPOSIT",
                "PIX"
              ],
              "x-readme-ref-name": "SubscriptionListRequestBillingType"
            }
          },
          {
            "name": "status",
            "in": "query",
            "description": "Filtrar pelo status",
            "schema": {
              "type": "string",
              "description": "Filtrar pelo status",
              "example": "ACTIVE",
              "deprecated": false,
              "enum": [
                "ACTIVE",
                "EXPIRED",
                "INACTIVE"
              ],
              "x-readme-ref-name": "SubscriptionListRequestSubscriptionStatus"
            }
          },
          {
            "name": "deletedOnly",
            "in": "query",
            "description": "Envie true para retornar somente as assinaturas removidas",
            "schema": {
              "type": "string",
              "example": null
            }
          },
          {
            "name": "includeDeleted",
            "in": "query",
            "description": "Envie true para recuperar também as assinaturas removidas",
            "schema": {
              "type": "string",
              "example": null
            }
          },
          {
            "name": "externalReference",
            "in": "query",
            "description": "Filtrar pelo Identificador do seu sistema",
            "schema": {
              "type": "string",
              "example": null
            }
          },
          {
            "name": "order",
            "in": "query",
            "description": "Ordem crescente ou decrescente",
            "schema": {
              "type": "string",
              "example": null
            }
          },
          {
            "name": "sort",
            "in": "query",
            "description": "Por qual campo será ordenado",
            "schema": {
              "type": "string",
              "example": null
            }
          }
        ],
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
                      "example": "list",
                      "deprecated": false
                    },
                    "hasMore": {
                      "type": "boolean",
                      "description": "Indica se há mais uma página a ser buscada",
                      "example": false,
                      "deprecated": false
                    },
                    "totalCount": {
                      "type": "integer",
                      "description": "Quantidade total de itens para os filtros informados",
                      "format": "int32",
                      "example": 2,
                      "deprecated": false
                    },
                    "limit": {
                      "type": "integer",
                      "description": "Quantidade de objetos por página",
                      "format": "int32",
                      "example": 10,
                      "deprecated": false
                    },
                    "offset": {
                      "type": "integer",
                      "description": "Posição do objeto a partir do qual a página deve ser carregada",
                      "format": "int32",
                      "example": 0,
                      "deprecated": false
                    },
                    "data": {
                      "type": "array",
                      "description": "Lista de objetos",
                      "deprecated": false,
                      "items": {
                        "type": "object",
                        "properties": {
                          "object": {
                            "type": "string",
                            "description": "Tipo do objeto",
                            "example": "subscription",
                            "deprecated": false
                          },
                          "id": {
                            "type": "string",
                            "description": "Identificador único da assinatura no Asaas",
                            "example": "sub_VXJBYgP2u0eO",
                            "deprecated": false
                          },
                          "dateCreated": {
                            "type": "string",
                            "description": "Data de criação da assinatura",
                            "format": "date",
                            "example": "2017-03-17",
                            "deprecated": false
                          },
                          "customer": {
                            "type": "string",
                            "description": "Identificador único do cliente",
                            "example": "cus_0T1mdomVMi39",
                            "deprecated": false
                          },
                          "paymentLink": {
                            "type": "string",
                            "description": "Identificador único do link de pagamentos ao qual a assinatura pertence",
                            "deprecated": false,
                            "example": null
                          },
                          "billingType": {
                            "type": "string",
                            "description": "Forma de pagamento",
                            "example": "BOLETO",
                            "deprecated": false,
                            "enum": [
                              "UNDEFINED",
                              "BOLETO",
                              "CREDIT_CARD",
                              "DEBIT_CARD",
                              "TRANSFER",
                              "DEPOSIT",
                              "PIX"
                            ],
                            "x-readme-ref-name": "SubscriptionGetResponseBillingType"
                          },
                          "cycle": {
                            "type": "string",
                            "description": "Periodicidade da cobrança",
                            "example": "MONTHLY",
                            "deprecated": false,
                            "enum": [
                              "WEEKLY",
                              "BIWEEKLY",
                              "MONTHLY",
                              "BIMONTHLY",
                              "QUARTERLY",
                              "SEMIANNUALLY",
                              "YEARLY"
                            ],
                            "x-readme-ref-name": "SubscriptionGetResponseCycle"
                          },
                          "value": {
                            "type": "number",
                            "description": "Valor da assinatura",
                            "example": 19.9,
                            "deprecated": false
                          },
                          "nextDueDate": {
                            "type": "string",
                            "description": "Vencimento do próximo pagamento a ser gerado",
                            "format": "date",
                            "example": "2017-06-15",
                            "deprecated": false
                          },
                          "endDate": {
                            "type": "string",
                            "description": "Data limite para vencimento das cobranças",
                            "format": "date",
                            "example": "2018-06-15",
                            "deprecated": false
                          },
                          "description": {
                            "type": "string",
                            "description": "Descrição da assinatura",
                            "example": "Assinatura Plano Pró",
                            "deprecated": false
                          },
                          "status": {
                            "type": "string",
                            "description": "Status da assinatura",
                            "example": "ACTIVE",
                            "deprecated": false,
                            "enum": [
                              "ACTIVE",
                              "EXPIRED",
                              "INACTIVE"
                            ],
                            "x-readme-ref-name": "SubscriptionGetResponseSubscriptionStatus"
                          },
                          "discount": {
                            "type": "object",
                            "properties": {
                              "value": {
                                "type": "number",
                                "description": "Valor percentual ou fixo de desconto a ser aplicado sobre o valor da cobrança",
                                "example": 10,
                                "deprecated": false
                              },
                              "dueDateLimitDays": {
                                "type": "integer",
                                "description": "Dias antes do vencimento para aplicar desconto. Ex: 0 = até o vencimento, 1 = até um dia antes, 2 = até dois dias antes, e assim por diante",
                                "format": "int32",
                                "example": 0,
                                "deprecated": false
                              },
                              "type": {
                                "type": "string",
                                "description": "Tipo de desconto",
                                "example": "PERCENTAGE",
                                "deprecated": false,
                                "enum": [
                                  "FIXED",
                                  "PERCENTAGE"
                                ],
                                "x-readme-ref-name": "PaymentDiscountDiscountType"
                              }
                            },
                            "description": "Informações de desconto",
                            "deprecated": false,
                            "x-readme-ref-name": "PaymentDiscountDTO"
                          },
                          "fine": {
                            "type": "object",
                            "properties": {
                              "value": {
                                "type": "number",
                                "description": "Valor da multa em porcentagem",
                                "example": 1,
                                "deprecated": false
                              }
                            },
                            "description": "Informações de multa para pagamento após o vencimento",
                            "deprecated": false,
                            "x-readme-ref-name": "PaymentFineResponseDTO"
                          },
                          "interest": {
                            "type": "object",
                            "properties": {
                              "value": {
                                "type": "number",
                                "description": "Valor dos juros em porcentagem",
                                "example": 2,
                                "deprecated": false
                              }
                            },
                            "description": "Informações de juros para pagamento após o vencimento",
                            "deprecated": false,
                            "x-readme-ref-name": "PaymentInterestResponseDTO"
                          },
                          "deleted": {
                            "type": "boolean",
                            "description": "Informa se a assinatura foi removida",
                            "example": false,
                            "deprecated": false
                          },
                          "maxPayments": {
                            "type": "integer",
                            "description": "Número máximo de cobranças a serem geradas para esta assinatura",
                            "format": "int32",
                            "example": 12,
                            "deprecated": false
                          },
                          "externalReference": {
                            "type": "string",
                            "description": "Identificador da assinatura no seu sistema",
                            "deprecated": false,
                            "example": null
                          },
                          "checkoutSession": {
                            "type": "string",
                            "description": "Identificador único do checkout",
                            "example": "356eb0c4-9eb7-4b7f-b2be-d9479af1d29f",
                            "deprecated": false
                          },
                          "split": {
                            "type": "array",
                            "description": "Informações de split",
                            "deprecated": false,
                            "items": {
                              "type": "object",
                              "properties": {
                                "walletId": {
                                  "type": "string",
                                  "description": "Identificador da carteira Asaas que será transferido",
                                  "example": "7bafd95a-e783-4a62-9be1-23999af742c6",
                                  "deprecated": false
                                },
                                "fixedValue": {
                                  "type": "number",
                                  "description": "Valor fixo a ser transferido para a conta quando a cobrança for recebida",
                                  "example": 20.32,
                                  "deprecated": false
                                },
                                "percentualValue": {
                                  "type": "number",
                                  "description": "Percentual sobre o valor líquido da cobrança a ser transferido quando for recebida",
                                  "deprecated": false,
                                  "example": null
                                },
                                "externalReference": {
                                  "type": "string",
                                  "description": "Identificador do split no seu sistema",
                                  "deprecated": false,
                                  "example": null
                                },
                                "description": {
                                  "type": "string",
                                  "description": "Descrição do split",
                                  "deprecated": false,
                                  "example": null
                                },
                                "status": {
                                  "type": "string",
                                  "description": "Status do split de assinatura",
                                  "example": "ACTIVE",
                                  "deprecated": false,
                                  "enum": [
                                    "ACTIVE",
                                    "DISABLED"
                                  ],
                                  "x-readme-ref-name": "SubscriptionSplitResponseSubscriptionSplitStatus"
                                },
                                "disabledReason": {
                                  "type": "string",
                                  "description": "Motivo pelo qual o split de assinatura foi desativado",
                                  "example": "WALLET_UNABLE_TO_RECEIVE",
                                  "deprecated": false,
                                  "enum": [
                                    "WALLET_UNABLE_TO_RECEIVE",
                                    "VALUE_DIVERGENCE"
                                  ],
                                  "x-readme-ref-name": "SubscriptionSplitResponseSubscriptionSplitDisabledReason"
                                }
                              },
                              "description": "Informações de split",
                              "deprecated": false,
                              "x-readme-ref-name": "SubscriptionSplitResponseDTO"
                            }
                          }
                        },
                        "x-readme-ref-name": "SubscriptionGetResponseDTO"
                      }
                    }
                  },
                  "x-readme-ref-name": "SubscriptionListResponseDTO"
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
          },
          "403": {
            "description": "Forbidden. Ocorre quando o body da requisição está preenchido, chamadas de método GET precisam ter um body vazio."
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