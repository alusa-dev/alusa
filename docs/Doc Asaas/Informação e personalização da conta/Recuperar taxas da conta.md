# Recuperar taxas da conta

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
      "name": "Informações e personalização da conta"
    }
  ],
  "paths": {
    "/v3/myAccount/fees/": {
      "get": {
        "tags": [
          "Informações e personalização da conta"
        ],
        "summary": "Recuperar taxas da conta",
        "description": "",
        "operationId": "recuperar-taxas-da-conta",
        "parameters": [],
        "responses": {
          "200": {
            "description": "Ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "payment": {
                      "type": "object",
                      "properties": {
                        "bankSlip": {
                          "type": "object",
                          "properties": {
                            "defaultValue": {
                              "type": "number",
                              "description": "Taxa por cobrança",
                              "example": 6.96,
                              "deprecated": false
                            },
                            "discountValue": {
                              "type": "number",
                              "description": "Taxa promocional (Se houver)",
                              "example": 3.99,
                              "deprecated": false
                            },
                            "expirationDate": {
                              "type": "string",
                              "description": "Data de expiração da taxa promocional (Se houver)",
                              "format": "date-time",
                              "example": "2019-05-19 00:00:00",
                              "deprecated": false
                            },
                            "daysToReceive": {
                              "type": "integer",
                              "description": "Dias para recebimento da cobrança",
                              "format": "int32",
                              "example": 1,
                              "deprecated": false
                            }
                          },
                          "description": "Taxas de boleto",
                          "deprecated": false,
                          "x-readme-ref-name": "MyAccountGetAccountFeesPaymentBankSlipDTO"
                        },
                        "creditCard": {
                          "type": "object",
                          "properties": {
                            "operationValue": {
                              "type": "number",
                              "description": "Taxa operacional por cobrança",
                              "example": 0.49,
                              "deprecated": false
                            },
                            "oneInstallmentPercentage": {
                              "type": "number",
                              "description": "Taxa percentual à vista",
                              "example": 2.99,
                              "deprecated": false
                            },
                            "upToSixInstallmentsPercentage": {
                              "type": "number",
                              "description": "Taxa percentual para 2 à 6 parcelas",
                              "example": 2.99,
                              "deprecated": false
                            },
                            "upToTwelveInstallmentsPercentage": {
                              "type": "number",
                              "description": "Taxa percentual para 7 à 12 parcelas",
                              "example": 2.99,
                              "deprecated": false
                            },
                            "upToTwentyOneInstallmentsPercentage": {
                              "type": "number",
                              "description": "Taxa percentual para 13 à 21 parcelas",
                              "example": 4.29,
                              "deprecated": false
                            },
                            "discountOneInstallmentPercentage": {
                              "type": "number",
                              "description": "Taxa percentual à vista promocional (Se houver)",
                              "example": 1.99,
                              "deprecated": false
                            },
                            "discountUpToSixInstallmentsPercentage": {
                              "type": "number",
                              "description": "Taxa percentual para 2 à 6 parcelas promocional (Se houver)",
                              "example": 1.99,
                              "deprecated": false
                            },
                            "discountUpToTwelveInstallmentsPercentage": {
                              "type": "number",
                              "description": "Taxa percentual para 7 à 12 parcelas promocional (Se houver)",
                              "example": 1.99,
                              "deprecated": false
                            },
                            "discountUpToTwentyOneInstallmentsPercentage": {
                              "type": "number",
                              "description": "Taxa percentual para 13 à 21 parcelas promocional (Se houver)",
                              "example": 3.29,
                              "deprecated": false
                            },
                            "discountExpiration": {
                              "type": "string",
                              "description": "Data de expiração da taxa promocional (Se houver)",
                              "format": "date-time",
                              "example": "2019-05-19 00:00:00",
                              "deprecated": false
                            },
                            "daysToReceive": {
                              "type": "integer",
                              "description": "Dias para recebimento da cobrança",
                              "format": "int32",
                              "example": 32,
                              "deprecated": false
                            }
                          },
                          "description": "Taxas de cartão de crédito",
                          "deprecated": false,
                          "x-readme-ref-name": "MyAccountGetAccountFeesPaymentCreditCardDTO"
                        },
                        "debitCard": {
                          "type": "object",
                          "properties": {
                            "operationValue": {
                              "type": "number",
                              "description": "Taxa operacional por cobrança",
                              "example": 0.35,
                              "deprecated": false
                            },
                            "defaultPercentage": {
                              "type": "number",
                              "description": "Taxa percentual por cobrança",
                              "example": 1.89,
                              "deprecated": false
                            },
                            "daysToReceive": {
                              "type": "integer",
                              "description": "Dias para recebimento da cobrança",
                              "format": "int32",
                              "example": 3,
                              "deprecated": false
                            }
                          },
                          "description": "Taxas de cartão de débito",
                          "deprecated": false,
                          "x-readme-ref-name": "MyAccountGetAccountFeesPaymentDebitCardDTO"
                        },
                        "pix": {
                          "type": "object",
                          "properties": {
                            "fixedFeeValue": {
                              "type": "number",
                              "description": "Taxa fixa (Se houver)",
                              "deprecated": false,
                              "example": null
                            },
                            "fixedFeeValueWithDiscount": {
                              "type": "number",
                              "description": "Taxa fixa promocional (Se houver)",
                              "deprecated": false,
                              "example": null
                            },
                            "percentageFee": {
                              "type": "number",
                              "description": "Taxa percentual (Se houver)",
                              "example": 0.99,
                              "deprecated": false
                            },
                            "minimumFeeValue": {
                              "type": "number",
                              "description": "Taxa fixa mínima em caso de taxa percentual",
                              "example": 0.29,
                              "deprecated": false
                            },
                            "maximumFeeValue": {
                              "type": "number",
                              "description": "Taxa fixa máxima em caso de taxa percentual",
                              "example": 1.99,
                              "deprecated": false
                            },
                            "discountExpiration": {
                              "type": "string",
                              "description": "Data de expiração da taxa promocional (Se houver)",
                              "format": "date-time",
                              "deprecated": false,
                              "example": null
                            },
                            "monthlyCreditsWithoutFee": {
                              "type": "integer",
                              "description": "Quantidade de transações grátis no mês",
                              "format": "int32",
                              "example": 30,
                              "deprecated": false
                            },
                            "creditsReceivedOfCurrentMonth": {
                              "type": "integer",
                              "description": "Quantas transações já recebeu este mês",
                              "format": "int32",
                              "example": 10,
                              "deprecated": false
                            }
                          },
                          "description": "Taxas de pix",
                          "deprecated": false,
                          "x-readme-ref-name": "MyAccountGetAccountFeesPaymentPixDTO"
                        }
                      },
                      "description": "Taxas de cobranças",
                      "deprecated": false,
                      "x-readme-ref-name": "MyAccountGetAccountFeesPaymentDTO"
                    },
                    "transfer": {
                      "type": "object",
                      "properties": {
                        "monthlyTransfersWithoutFee": {
                          "type": "integer",
                          "description": "Quantidade de transações grátis mensais",
                          "format": "int32",
                          "example": 30,
                          "deprecated": false
                        },
                        "ted": {
                          "type": "object",
                          "properties": {
                            "feeValue": {
                              "type": "number",
                              "description": "Taxa por transferência via TED",
                              "example": 5,
                              "deprecated": false
                            },
                            "consideredInMonthlyTransfersWithoutFee": {
                              "type": "boolean",
                              "description": "Indica se a quantidade de transações grátis mensais considera TED",
                              "example": true,
                              "deprecated": false
                            }
                          },
                          "description": "Taxas para transferências TED",
                          "deprecated": false,
                          "x-readme-ref-name": "MyAccountGetAccountFeesTransferTedDTO"
                        },
                        "pix": {
                          "type": "object",
                          "properties": {
                            "feeValue": {
                              "type": "number",
                              "description": "Taxa por envio de transferências via Pix",
                              "example": 5,
                              "deprecated": false
                            },
                            "discountValue": {
                              "type": "number",
                              "description": "Taxa promocional (Se houver)",
                              "deprecated": false,
                              "example": null
                            },
                            "expirationDate": {
                              "type": "string",
                              "description": "Data de expiração da taxa promocional (Se houver)",
                              "format": "date-time",
                              "deprecated": false,
                              "example": null
                            },
                            "consideredInMonthlyTransfersWithoutFee": {
                              "type": "boolean",
                              "description": "Indica se a quantidade de transações grátis mensais considera Pix",
                              "example": true,
                              "deprecated": false
                            }
                          },
                          "description": "Taxas para transferências Pix",
                          "deprecated": false,
                          "x-readme-ref-name": "MyAccountGetAccountFeesTransferPixDTO"
                        }
                      },
                      "description": "Taxas de transferências",
                      "deprecated": false,
                      "x-readme-ref-name": "MyAccountGetAccountFeesTransferDTO"
                    },
                    "notification": {
                      "type": "object",
                      "properties": {
                        "phoneCallFeeValue": {
                          "type": "number",
                          "description": "Taxas por ligação de robô de voz",
                          "example": 0.55,
                          "deprecated": false
                        },
                        "whatsAppFeeValue": {
                          "type": "number",
                          "description": "Taxas por notificações via WhatsApp",
                          "example": 0.55,
                          "deprecated": false
                        },
                        "messagingFeeValue": {
                          "type": "number",
                          "description": "Taxas por envio de e-mails e SMS",
                          "example": 0.99,
                          "deprecated": false
                        }
                      },
                      "description": "Taxas de notificação",
                      "deprecated": false,
                      "x-readme-ref-name": "MyAccountGetAccountFeesNotificationDTO"
                    },
                    "creditBureauReport": {
                      "type": "object",
                      "properties": {
                        "naturalPersonFeeValue": {
                          "type": "number",
                          "description": "Taxa por consulta Serasa de pessoa física",
                          "example": 16.99,
                          "deprecated": false
                        },
                        "legalPersonFeeValue": {
                          "type": "number",
                          "description": "Taxa por consulta Serasa de pessoa jurídica",
                          "example": 16.99,
                          "deprecated": false
                        }
                      },
                      "description": "Taxas de consulta Serasa",
                      "deprecated": false,
                      "x-readme-ref-name": "MyAccountGetAccountFeesCreditBureauReportDTO"
                    },
                    "paymentDunning": {
                      "type": "object",
                      "properties": {
                        "feeValue": {
                          "type": "number",
                          "description": "Taxa por cobrança",
                          "example": 9.9,
                          "deprecated": false
                        }
                      },
                      "description": "Taxas de negativação Serasa",
                      "deprecated": false,
                      "x-readme-ref-name": "MyAccountGetAccountFeesPaymentDunningDTO"
                    },
                    "invoice": {
                      "type": "object",
                      "properties": {
                        "feeValue": {
                          "type": "number",
                          "description": "Taxa por nota de serviço emitida",
                          "example": 0.99,
                          "deprecated": false
                        }
                      },
                      "description": "Taxas de notas fiscais",
                      "deprecated": false,
                      "x-readme-ref-name": "MyAccountGetAccountFeesInvoiceDTO"
                    },
                    "anticipation": {
                      "type": "object",
                      "properties": {
                        "creditCard": {
                          "type": "object",
                          "properties": {
                            "detachedMonthlyFeeValue": {
                              "type": "number",
                              "description": "Taxa ao mês para cobranças à vista",
                              "example": 2.49,
                              "deprecated": false
                            },
                            "installmentMonthlyFeeValue": {
                              "type": "integer",
                              "description": "Taxa ao mês para cobranças parceladas",
                              "format": "int32",
                              "example": 2,
                              "deprecated": false
                            }
                          },
                          "description": "Tarifa de antecipações em cartão de crédito",
                          "deprecated": false,
                          "x-readme-ref-name": "MyAccountGetAccountFeesAnticipationCreditCardDTO"
                        },
                        "bankSlip": {
                          "type": "object",
                          "properties": {
                            "monthlyFeePercentage": {
                              "type": "number",
                              "description": "Taxa ao mês para cobranças em boleto",
                              "example": 4.99,
                              "deprecated": false
                            }
                          },
                          "description": "Tarifa de antecipações em boletos",
                          "deprecated": false,
                          "x-readme-ref-name": "MyAccountGetAccountFeesAnticipationBankSlipDTO"
                        }
                      },
                      "description": "Taxas de antecipação",
                      "deprecated": false,
                      "x-readme-ref-name": "MyAccountGetAccountFeesAnticipationDTO"
                    }
                  },
                  "x-readme-ref-name": "MyAccountGetAccountFeesResponseDTO"
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