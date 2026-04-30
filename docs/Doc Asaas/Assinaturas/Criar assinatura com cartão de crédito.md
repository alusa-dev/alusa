# Criar assinatura com cartão de crédito

Assim como na cobrança, os dados do cartão e do portador podem ser enviados na requisição de criação da assinatura para que o pagamento já seja processado. A diferença é que no caso da cobrança o cartão do cliente é cobrado no momento da criação da mesma, já no caso da assinatura, o cartão será validado no momento da criação, porém a cobrança será feita somente no vencimento da primeira mensalidade. É importante ressaltar que a validação feita no momento a criação não garante que cobrança ocorrerá com sucesso no vencimento, pois neste meio-tempo o cartão pode ter sido cancelado, expirado, não ter limite, entre outros.

Para tal, ao executar a requisição de criação da assinatura, basta enviar os dados do cartão de crédito juntamente com os dados do titular através dos objetos `creditCard` e `creditCardHolderInfo`. Se a transação for autorizada a assinatura será criada e o Asaas retornará `HTTP 200`. Caso contrário a assinatura não será persistida e será retornado `HTTP 400`.

Uma vez criada a assinatura com cartão de crédito, a cobrança será feita mensalmente (ou outra periodicidade definida) no cartão do cliente até que ele se torne inválido ou você remova a assinatura.

> 🚧 Atenção
>
> * Caso você opte por capturar na interface do seu sistema os dados do cartão do cliente, é obrigatório o uso de SSL (HTTPS), caso contrário sua conta pode ser bloqueada para transações via cartão de crédito.
> * Para se evitar timeouts e decorrentemente duplicidades na captura, recomendamos a configuração de um timeout mínimo de 60 segundos para este request.

### Tokenização de cartão de crédito

Para utilizar a tokenização de cartão de crédito na criação de assinaturas você deve seguir as mesmas instruções do [Criar cobrança com cartão de crédito](https://docs.asaas.com/reference/criar-nova-cobranca-com-cartao-de-credito).

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
    "/v3/subscriptions/": {
      "post": {
        "tags": [
          "Assinaturas"
        ],
        "summary": "Criar assinatura com cartão de crédito",
        "description": "",
        "operationId": "criar-assinatura-com-cartao-de-credito",
        "parameters": [],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "customer",
                  "billingType",
                  "value",
                  "nextDueDate",
                  "cycle",
                  "creditCard",
                  "creditCardHolderInfo",
                  "remoteIp"
                ],
                "type": "object",
                "properties": {
                  "customer": {
                    "type": "string",
                    "description": "Identificador único do cliente no Asaas",
                    "nullable": false,
                    "example": "cus_0T1mdomVMi39",
                    "deprecated": false
                  },
                  "billingType": {
                    "type": "string",
                    "description": "Forma de pagamento",
                    "nullable": false,
                    "example": "BOLETO",
                    "deprecated": false,
                    "enum": [
                      "UNDEFINED",
                      "BOLETO",
                      "CREDIT_CARD",
                      "PIX"
                    ],
                    "x-readme-ref-name": "SubscriptionSaveWithCreditCardRequestBillingType"
                  },
                  "value": {
                    "type": "number",
                    "description": "Valor da assinatura",
                    "nullable": false,
                    "example": 19.9,
                    "deprecated": false
                  },
                  "nextDueDate": {
                    "type": "string",
                    "description": "Vencimento da primeira cobrança",
                    "format": "date",
                    "nullable": false,
                    "example": "2017-05-15",
                    "deprecated": false
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
                  "interest": {
                    "type": "object",
                    "properties": {
                      "value": {
                        "type": "number",
                        "description": "Percentual de juros *ao mês* sobre o valor da cobrança para pagamento após o vencimento",
                        "deprecated": false,
                        "example": null
                      }
                    },
                    "description": "Informações de juros para pagamento após o vencimento",
                    "deprecated": false,
                    "x-readme-ref-name": "PaymentInterestRequestDTO"
                  },
                  "fine": {
                    "type": "object",
                    "properties": {
                      "value": {
                        "type": "number",
                        "description": "Percentual de multa sobre o valor da cobrança para pagamento após o vencimento",
                        "deprecated": false,
                        "example": null
                      },
                      "type": {
                        "type": "string",
                        "description": "Tipo de multa",
                        "example": "FIXED",
                        "deprecated": false,
                        "enum": [
                          "FIXED",
                          "PERCENTAGE"
                        ],
                        "x-readme-ref-name": "PaymentFineRequestFineType"
                      }
                    },
                    "description": "Informações de multa para pagamento após o vencimento",
                    "deprecated": false,
                    "x-readme-ref-name": "PaymentFineRequestDTO"
                  },
                  "cycle": {
                    "type": "string",
                    "description": "Periodicidade da cobrança",
                    "nullable": false,
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
                    "x-readme-ref-name": "SubscriptionSaveWithCreditCardRequestCycle"
                  },
                  "description": {
                    "type": "string",
                    "description": "Descrição da assinatura (máx. 500 caracteres)",
                    "example": "Assinatura Plano Pró",
                    "deprecated": false
                  },
                  "endDate": {
                    "type": "string",
                    "description": "Data limite para vencimento das cobranças",
                    "format": "date",
                    "deprecated": false,
                    "example": null
                  },
                  "maxPayments": {
                    "type": "integer",
                    "description": "Número máximo de cobranças a serem geradas para esta assinatura",
                    "format": "int32",
                    "deprecated": false,
                    "example": null
                  },
                  "externalReference": {
                    "type": "string",
                    "description": "Identificador da assinatura no seu sistema",
                    "deprecated": false,
                    "example": null
                  },
                  "split": {
                    "type": "array",
                    "description": "Informações de split",
                    "deprecated": false,
                    "items": {
                      "required": [
                        "walletId"
                      ],
                      "type": "object",
                      "properties": {
                        "walletId": {
                          "type": "string",
                          "description": "Identificador da carteira Asaas que será transferido",
                          "nullable": false,
                          "deprecated": false,
                          "example": null
                        },
                        "fixedValue": {
                          "type": "number",
                          "description": "Valor fixo a ser transferido para a conta quando a cobrança for recebida",
                          "deprecated": false,
                          "example": null
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
                        }
                      },
                      "description": "Informações de split",
                      "deprecated": false,
                      "x-readme-ref-name": "SubscriptionSplitRequestDTO"
                    }
                  },
                  "callback": {
                    "required": [
                      "successUrl"
                    ],
                    "type": "object",
                    "properties": {
                      "successUrl": {
                        "maxLength": 255,
                        "type": "string",
                        "description": "URL que o cliente será redirecionado após o pagamento com sucesso da fatura ou link de pagamento",
                        "nullable": false,
                        "deprecated": false,
                        "example": null
                      },
                      "autoRedirect": {
                        "type": "boolean",
                        "description": "Definir se o cliente será redirecionado automaticamente ou será apenas informado com um botão para retornar ao site. O padrão é true, caso queira desativar informar false",
                        "deprecated": false,
                        "example": null
                      }
                    },
                    "description": "Informações de redirecionamento automático após pagamento do link de pagamento",
                    "deprecated": false,
                    "x-readme-ref-name": "PaymentCallbackRequestDTO"
                  },
                  "creditCard": {
                    "required": [
                      "holderName",
                      "number",
                      "expiryMonth",
                      "expiryYear",
                      "ccv"
                    ],
                    "type": "object",
                    "properties": {
                      "holderName": {
                        "type": "string",
                        "description": "Nome impresso no cartão",
                        "nullable": false,
                        "example": "John Doe",
                        "deprecated": false
                      },
                      "number": {
                        "type": "string",
                        "description": "Número do cartão",
                        "nullable": false,
                        "example": "1234567890123456",
                        "deprecated": false
                      },
                      "expiryMonth": {
                        "type": "string",
                        "description": "Mês de expiração com 2 dígitos",
                        "nullable": false,
                        "example": "1",
                        "deprecated": false
                      },
                      "expiryYear": {
                        "type": "string",
                        "description": "Ano de expiração com 4 dígitos",
                        "nullable": false,
                        "example": "2026",
                        "deprecated": false
                      },
                      "ccv": {
                        "type": "string",
                        "description": "Código de segurança",
                        "nullable": false,
                        "example": "123",
                        "deprecated": false
                      }
                    },
                    "description": "Informações do cartão de crédito",
                    "nullable": false,
                    "deprecated": false,
                    "x-readme-ref-name": "CreditCardRequestDTO"
                  },
                  "creditCardHolderInfo": {
                    "required": [
                      "name",
                      "email",
                      "cpfCnpj",
                      "postalCode",
                      "addressNumber",
                      "phone"
                    ],
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string",
                        "description": "Nome do titular do cartão",
                        "nullable": false,
                        "example": "John Doe",
                        "deprecated": false
                      },
                      "email": {
                        "type": "string",
                        "description": "Email do titular do cartão",
                        "nullable": false,
                        "example": "john.doe@asaas.com",
                        "deprecated": false
                      },
                      "cpfCnpj": {
                        "type": "string",
                        "description": "CPF ou CNPJ do titular do cartão",
                        "nullable": false,
                        "example": "12345678901",
                        "deprecated": false
                      },
                      "postalCode": {
                        "type": "string",
                        "description": "CEP do titular do cartão",
                        "nullable": false,
                        "example": "12345678",
                        "deprecated": false
                      },
                      "addressNumber": {
                        "type": "string",
                        "description": "Número do endereço do titular do cartão",
                        "nullable": false,
                        "example": "123",
                        "deprecated": false
                      },
                      "addressComplement": {
                        "type": "string",
                        "description": "Complemento do endereço do titular do cartão",
                        "deprecated": false,
                        "example": null
                      },
                      "phone": {
                        "type": "string",
                        "description": "Telefone com DDD do titular do cartão",
                        "nullable": false,
                        "deprecated": false,
                        "example": null
                      },
                      "mobilePhone": {
                        "type": "string",
                        "description": "Celular do titular do cartão",
                        "deprecated": false,
                        "example": null
                      }
                    },
                    "description": "Informações do titular do cartão de crédito",
                    "nullable": false,
                    "deprecated": false,
                    "x-readme-ref-name": "CreditCardHolderInfoRequestDTO"
                  },
                  "creditCardToken": {
                    "type": "string",
                    "description": "Token do cartão de crédito para uso da funcionalidade de tokenização de cartão de crédito. Caso informado, os campos acima não são obrigatórios.",
                    "example": "a75a1d98-c52d-4a6b-a413-71e00b193c99",
                    "deprecated": false
                  },
                  "remoteIp": {
                    "type": "string",
                    "description": "IP de onde o cliente está fazendo a compra. Não deve ser informado o IP do seu servidor.",
                    "nullable": false,
                    "deprecated": false,
                    "example": null
                  }
                },
                "x-readme-ref-name": "SubscriptionSaveWithCreditCardRequestDTO"
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
                      "x-readme-ref-name": "SubscriptionSaveWithCreditCardResponseBillingType"
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
                      "x-readme-ref-name": "SubscriptionSaveWithCreditCardResponseCycle"
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
                      "x-readme-ref-name": "SubscriptionSaveWithCreditCardResponseSubscriptionStatus"
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
                    },
                    "creditCard": {
                      "type": "object",
                      "properties": {
                        "creditCardNumber": {
                          "type": "string",
                          "description": "Últimos 4 dígitos do cartão utilizado",
                          "example": "8829",
                          "deprecated": false
                        },
                        "creditCardBrand": {
                          "type": "string",
                          "description": "Bandeira do cartão utilizado",
                          "example": "VISA",
                          "deprecated": false,
                          "enum": [
                            "VISA",
                            "MASTERCARD",
                            "ELO",
                            "DINERS",
                            "DISCOVER",
                            "AMEX",
                            "CABAL",
                            "BANESCARD",
                            "CREDZ",
                            "SOROCRED",
                            "CREDSYSTEM",
                            "JCB",
                            "UNKNOWN"
                          ],
                          "x-readme-ref-name": "PaymentSaveWithCreditCardCreditCardCreditCardBrand"
                        },
                        "creditCardToken": {
                          "type": "string",
                          "description": "Token do cartão de crédito caso a tokenização esteja ativa.",
                          "deprecated": false,
                          "example": null
                        }
                      },
                      "description": "Informações do cartão de crédito",
                      "deprecated": false,
                      "x-readme-ref-name": "PaymentSaveWithCreditCardCreditCardDTO"
                    }
                  },
                  "x-readme-ref-name": "SubscriptionSaveWithCreditCardResponseDTO"
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