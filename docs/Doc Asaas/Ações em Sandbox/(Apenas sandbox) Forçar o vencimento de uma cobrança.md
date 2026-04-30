# (Apenas sandbox) Forçar o vencimento de uma cobrança

Esse endpoint força o vencimento de uma cobrança no ambiente sandbox.

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
      "name": "Ações em sandbox"
    }
  ],
  "paths": {
    "/v3/sandbox/payment/{id}/overdue": {
      "post": {
        "tags": [
          "Ações em sandbox"
        ],
        "summary": "(Apenas sandbox) Forçar o vencimento de uma cobrança",
        "description": "Esse endpoint força o vencimento de uma cobrança no ambiente sandbox.",
        "operationId": "forcar-vencimento",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "description": "Identificador único da cobrança no Asaas",
            "required": true,
            "schema": {
              "type": "string",
              "example": null
            }
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {},
                "x-readme-ref-name": "PaymentPathIdRequestDTO"
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
                      "example": "payment",
                      "deprecated": false
                    },
                    "id": {
                      "type": "string",
                      "description": "Identificador único da cobrança no Asaas",
                      "example": "pay_080225913252",
                      "deprecated": false
                    },
                    "dateCreated": {
                      "type": "string",
                      "description": "Data de criação da cobrança",
                      "format": "date",
                      "example": "2017-03-10",
                      "deprecated": false
                    },
                    "customer": {
                      "type": "string",
                      "description": "Identificador único do cliente ao qual a cobrança pertence",
                      "example": "cus_G7Dvo4iphUNk",
                      "deprecated": false
                    },
                    "subscription": {
                      "type": "string",
                      "description": "Identificador único da assinatura (quando cobrança recorrente)",
                      "deprecated": false,
                      "example": null
                    },
                    "installment": {
                      "type": "string",
                      "description": "Identificador único do parcelamento (quando cobrança parcelada)",
                      "deprecated": false,
                      "example": null
                    },
                    "checkoutSession": {
                      "type": "string",
                      "description": "Identificador único do checkout",
                      "example": "356eb0c4-9eb7-4b7f-b2be-d9479af1d29f",
                      "deprecated": false
                    },
                    "paymentLink": {
                      "type": "string",
                      "description": "Identificador único do link de pagamentos ao qual a cobrança pertence",
                      "deprecated": false,
                      "example": null
                    },
                    "value": {
                      "type": "number",
                      "description": "Valor da cobrança",
                      "example": 129.9,
                      "deprecated": false
                    },
                    "netValue": {
                      "type": "number",
                      "description": "Valor líquido da cobrança após desconto da tarifa do Asaas",
                      "example": 124.9,
                      "deprecated": false
                    },
                    "originalValue": {
                      "type": "number",
                      "description": "Valor original da cobrança (preenchido quando paga com juros e multa)",
                      "deprecated": false,
                      "example": null
                    },
                    "interestValue": {
                      "type": "number",
                      "description": "Valor calculado de juros e multa que deve ser pago após o vencimento da cobrança",
                      "deprecated": false,
                      "example": null
                    },
                    "description": {
                      "type": "string",
                      "description": "Descrição da cobrança",
                      "example": "Pedido 056984",
                      "deprecated": false
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
                      "x-readme-ref-name": "PaymentGetResponseBillingType"
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
                    },
                    "canBePaidAfterDueDate": {
                      "type": "boolean",
                      "description": "Informa se a cobrança pode ser paga após o vencimento (Somente para boleto)",
                      "example": true,
                      "deprecated": false
                    },
                    "pixTransaction": {
                      "type": "string",
                      "description": "Identificador único da transação Pix à qual a cobrança pertence",
                      "deprecated": false,
                      "example": null
                    },
                    "pixQrCodeId": {
                      "type": "string",
                      "description": "Identificador único do QrCode estático gerado para determinada chave Pix",
                      "deprecated": false,
                      "example": null
                    },
                    "status": {
                      "type": "string",
                      "description": "Status da cobrança",
                      "example": "PENDING",
                      "deprecated": false,
                      "enum": [
                        "PENDING",
                        "RECEIVED",
                        "CONFIRMED",
                        "OVERDUE",
                        "REFUNDED",
                        "RECEIVED_IN_CASH",
                        "REFUND_REQUESTED",
                        "REFUND_IN_PROGRESS",
                        "CHARGEBACK_REQUESTED",
                        "CHARGEBACK_DISPUTE",
                        "AWAITING_CHARGEBACK_REVERSAL",
                        "DUNNING_REQUESTED",
                        "DUNNING_RECEIVED",
                        "AWAITING_RISK_ANALYSIS"
                      ],
                      "x-readme-ref-name": "PaymentGetResponsePaymentStatus"
                    },
                    "dueDate": {
                      "type": "string",
                      "description": "Data de vencimento da cobrança",
                      "format": "date",
                      "example": "2017-06-10",
                      "deprecated": false
                    },
                    "originalDueDate": {
                      "type": "string",
                      "description": "Vencimento original no ato da criação da cobrança",
                      "format": "date",
                      "example": "2017-06-10",
                      "deprecated": false
                    },
                    "paymentDate": {
                      "type": "string",
                      "description": "Data de liquidação da cobrança no Asaas",
                      "format": "date",
                      "deprecated": false,
                      "example": null
                    },
                    "clientPaymentDate": {
                      "type": "string",
                      "description": "Data em que o cliente efetuou o pagamento do boleto",
                      "format": "date",
                      "deprecated": false,
                      "example": null
                    },
                    "installmentNumber": {
                      "type": "integer",
                      "description": "Número da parcela",
                      "format": "int32",
                      "deprecated": false,
                      "example": null
                    },
                    "invoiceUrl": {
                      "type": "string",
                      "description": "URL da fatura",
                      "example": "https://www.asaas.com/i/080225913252",
                      "deprecated": false
                    },
                    "invoiceNumber": {
                      "type": "string",
                      "description": "Número da fatura",
                      "example": "00005101",
                      "deprecated": false
                    },
                    "externalReference": {
                      "type": "string",
                      "description": "Campo livre para busca",
                      "example": "056984",
                      "deprecated": false
                    },
                    "deleted": {
                      "type": "boolean",
                      "description": "Determina se a cobrança foi removida",
                      "example": false,
                      "deprecated": false
                    },
                    "anticipated": {
                      "type": "boolean",
                      "description": "Define se a cobrança foi antecipada ou está em processo de antecipação",
                      "example": false,
                      "deprecated": false
                    },
                    "anticipable": {
                      "type": "boolean",
                      "description": "Determina se a cobrança é antecipável",
                      "example": false,
                      "deprecated": false
                    },
                    "creditDate": {
                      "type": "string",
                      "description": "Indica a data que o crédito ficou disponível",
                      "format": "date",
                      "example": "2017-06-10",
                      "deprecated": false
                    },
                    "estimatedCreditDate": {
                      "type": "string",
                      "description": "Data estimada de quando o crédito ficará disponível",
                      "format": "date",
                      "example": "2017-06-10",
                      "deprecated": false
                    },
                    "transactionReceiptUrl": {
                      "type": "string",
                      "description": "URL do comprovante de confirmação, recebimento, estorno ou remoção.",
                      "deprecated": false,
                      "example": null
                    },
                    "nossoNumero": {
                      "type": "string",
                      "description": "Identificação única do boleto",
                      "example": "6453",
                      "deprecated": false
                    },
                    "bankSlipUrl": {
                      "type": "string",
                      "description": "URL para download do boleto",
                      "example": "https://www.asaas.com/b/pdf/080225913252",
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
                    "split": {
                      "type": "array",
                      "description": "Configurações do split",
                      "deprecated": false,
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string",
                            "description": "Identificador único do split pago no Asaas",
                            "example": "fd41396a-7453-47d0-9411-c8543522591d",
                            "deprecated": false
                          },
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
                          "totalValue": {
                            "type": "number",
                            "description": "Valor total do split que será enviado. Os valores exibidos podem sofrer alteração após a confirmação ou alteração da cobrança.",
                            "example": 20.32,
                            "deprecated": false
                          },
                          "cancellationReason": {
                            "type": "string",
                            "description": "Motivo de cancelamento do split",
                            "example": "PAYMENT_DELETED",
                            "deprecated": false,
                            "enum": [
                              "PAYMENT_DELETED",
                              "PAYMENT_OVERDUE",
                              "PAYMENT_RECEIVED_IN_CASH",
                              "PAYMENT_REFUNDED",
                              "VALUE_DIVERGENCE_BLOCK",
                              "WALLET_UNABLE_TO_RECEIVE"
                            ],
                            "x-readme-ref-name": "PaymentSplitGetResponsePaymentSplitCancellationReason"
                          },
                          "status": {
                            "type": "string",
                            "description": "Status do split",
                            "example": "PENDING",
                            "deprecated": false,
                            "enum": [
                              "PENDING",
                              "PROCESSING",
                              "PROCESSING_REFUND",
                              "AWAITING_CREDIT",
                              "CANCELLED",
                              "DONE",
                              "REFUNDED",
                              "BLOCKED_BY_VALUE_DIVERGENCE"
                            ],
                            "x-readme-ref-name": "PaymentSplitGetResponsePaymentSplitStatus"
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
                        "description": "Configurações do split",
                        "deprecated": false,
                        "x-readme-ref-name": "PaymentSplitGetResponseDTO"
                      }
                    },
                    "postalService": {
                      "type": "boolean",
                      "description": "Define se a cobrança será enviada via Correios",
                      "example": false,
                      "deprecated": false
                    },
                    "daysAfterDueDateToRegistrationCancellation": {
                      "type": "integer",
                      "description": "Dias após o vencimento para cancelamento do registro (somente para boleto bancário)",
                      "format": "int32",
                      "deprecated": false,
                      "example": null
                    },
                    "chargeback": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "description": "Identificador único do chargeback.",
                          "example": "8e784c3e-afe8-4844-bb93-6b445763",
                          "deprecated": false
                        },
                        "payment": {
                          "type": "string",
                          "description": "Identificador único da cobrança no Asaas",
                          "example": "pay_pBtDdshgBD2Rt",
                          "deprecated": false
                        },
                        "installment": {
                          "type": "string",
                          "description": "Identificador único do parcelamento no Asaas",
                          "example": "b8dd74c-d078-40a0-9ae1-61a66c61a204",
                          "deprecated": false
                        },
                        "customerAccount": {
                          "type": "string",
                          "description": "Identificador único do cliente ao qual o chargeback está vinculado.",
                          "example": "cus_000000004085",
                          "deprecated": false
                        },
                        "status": {
                          "type": "string",
                          "description": "Status do chargeback",
                          "example": "DONE",
                          "deprecated": false,
                          "enum": [
                            "REQUESTED",
                            "IN_DISPUTE",
                            "DISPUTE_LOST",
                            "REVERSED",
                            "DONE"
                          ],
                          "x-readme-ref-name": "PaymentChargebackResponseChargebackStatus"
                        },
                        "reason": {
                          "type": "string",
                          "description": "Razão do chargeback",
                          "example": "COMMERCIAL_DISAGREEMENT",
                          "deprecated": false,
                          "enum": [
                            "ABSENCE_OF_PRINT",
                            "ABSENT_CARD_FRAUD",
                            "CARD_ACTIVATED_PHONE_TRANSACTION",
                            "CARD_FRAUD",
                            "CARD_RECOVERY_BULLETIN",
                            "COMMERCIAL_DISAGREEMENT",
                            "COPY_NOT_RECEIVED",
                            "CREDIT_OR_DEBIT_PRESENTATION_ERROR",
                            "DIFFERENT_PAY_METHOD",
                            "FRAUD",
                            "INCORRECT_TRANSACTION_VALUE",
                            "INVALID_CURRENCY",
                            "INVALID_DATA",
                            "LATE_PRESENTATION",
                            "LOCAL_REGULATORY_OR_LEGAL_DISPUTE",
                            "MULTIPLE_ROCS",
                            "ORIGINAL_CREDIT_TRANSACTION_NOT_ACCEPTED",
                            "OTHER_ABSENT_CARD_FRAUD",
                            "PROCESS_ERROR",
                            "RECEIVED_COPY_ILLEGIBLE_OR_INCOMPLETE",
                            "RECURRENCE_CANCELED",
                            "REQUIRED_AUTHORIZATION_NOT_GRANTED",
                            "RIGHT_OF_FULL_RECOURSE_FOR_FRAUD",
                            "SALE_CANCELED",
                            "SERVICE_DISAGREEMENT_OR_DEFECTIVE_PRODUCT",
                            "SERVICE_NOT_RECEIVED",
                            "SPLIT_SALE",
                            "TRANSFERS_OF_DIVERSE_RESPONSIBILITIES",
                            "UNQUALIFIED_CAR_RENTAL_DEBIT",
                            "USA_CARDHOLDER_DISPUTE",
                            "VISA_FRAUD_MONITORING_PROGRAM",
                            "WARNING_BULLETIN_FILE"
                          ],
                          "x-readme-ref-name": "PaymentChargebackResponseChargebackReason"
                        },
                        "disputeStartDate": {
                          "type": "string",
                          "description": "Data de abertura do chargeback.",
                          "format": "date",
                          "example": "2024-11-10",
                          "deprecated": false
                        },
                        "value": {
                          "type": "number",
                          "description": "Valor do chargeback.",
                          "example": 2323.45,
                          "deprecated": false
                        },
                        "paymentDate": {
                          "type": "string",
                          "description": "Data de liquidação da cobrança no Asaas",
                          "format": "date",
                          "example": "2024-03-10",
                          "deprecated": false
                        },
                        "creditCard": {
                          "type": "object",
                          "properties": {
                            "number": {
                              "type": "string",
                              "description": "Últimos 4 dígitos do cartão utilizado",
                              "example": "8829",
                              "deprecated": false
                            },
                            "brand": {
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
                              "x-readme-ref-name": "ChargebackCreditCardResponseCreditCardBrand"
                            }
                          },
                          "description": "Informações do cartão de crédito",
                          "deprecated": false,
                          "x-readme-ref-name": "ChargebackCreditCardResponseDTO"
                        },
                        "disputeStatus": {
                          "type": "string",
                          "description": "Status da disputa do chargeback.",
                          "example": "ACCEPTED",
                          "deprecated": false,
                          "enum": [
                            "REQUESTED",
                            "ACCEPTED",
                            "REJECTED"
                          ],
                          "x-readme-ref-name": "PaymentChargebackResponseChargebackDisputeStatus"
                        },
                        "deadlineToSendDisputeDocuments": {
                          "type": "string",
                          "description": "Data limite para envio de documentos de disputa.",
                          "format": "date",
                          "example": "2024-12-10",
                          "deprecated": false
                        }
                      },
                      "x-readme-ref-name": "PaymentChargebackResponseDTO"
                    },
                    "escrow": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "description": "Identificador único da garantia da cobrança na Conta Escrow do Asaas",
                          "example": "4f468235-cec3-482f-b3d0-348af4c7194",
                          "deprecated": false
                        },
                        "status": {
                          "type": "string",
                          "description": "Status da garantia da cobrança",
                          "example": "ACTIVE",
                          "deprecated": false,
                          "enum": [
                            "ACTIVE",
                            "DONE"
                          ],
                          "x-readme-ref-name": "PaymentEscrowGetResponsePaymentEscrowStatus"
                        },
                        "expirationDate": {
                          "type": "string",
                          "description": "Data de expiração da garantia da cobrança",
                          "format": "date",
                          "example": "2024-06-10",
                          "deprecated": false
                        },
                        "finishDate": {
                          "type": "string",
                          "description": "Data de encerramento da garantia da cobrança",
                          "format": "date",
                          "example": "2024-06-10",
                          "deprecated": false
                        },
                        "finishReason": {
                          "type": "string",
                          "description": "Motivo do encerramento da garantia da cobrança",
                          "example": "EXPIRED",
                          "deprecated": false,
                          "enum": [
                            "CHARGEBACK",
                            "EXPIRED",
                            "INSUFFICIENT_BALANCE",
                            "PAYMENT_REFUNDED",
                            "REQUESTED_BY_CUSTOMER",
                            "CUSTOMER_CONFIG_DISABLED"
                          ],
                          "x-readme-ref-name": "PaymentEscrowGetResponsePaymentEscrowFinishReason"
                        }
                      },
                      "description": "Informações de garantia da cobrança na Conta Escrow",
                      "deprecated": false,
                      "x-readme-ref-name": "PaymentEscrowGetResponseDTO"
                    },
                    "refunds": {
                      "type": "array",
                      "description": "Informações de estorno",
                      "deprecated": false,
                      "items": {
                        "type": "object",
                        "properties": {
                          "dateCreated": {
                            "type": "string",
                            "description": "Data da criação do estorno",
                            "format": "date-time",
                            "example": "2024-10-18 10:19:06",
                            "deprecated": false
                          },
                          "status": {
                            "type": "string",
                            "description": "Status do estorno",
                            "example": "DONE",
                            "deprecated": false,
                            "enum": [
                              "PENDING",
                              "AWAITING_CRITICAL_ACTION_AUTHORIZATION",
                              "AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION",
                              "CANCELLED",
                              "DONE"
                            ],
                            "x-readme-ref-name": "PaymentRefundGetResponsePaymentRefundStatus"
                          },
                          "value": {
                            "type": "number",
                            "description": "Valor do estorno",
                            "example": 40,
                            "deprecated": false
                          },
                          "endToEndIdentifier": {
                            "type": "string",
                            "description": "(Apenas pix) Identificador da transação Pix no Banco Central",
                            "deprecated": false,
                            "example": null
                          },
                          "description": {
                            "type": "string",
                            "description": "Descrição do estorno",
                            "deprecated": false,
                            "example": null
                          },
                          "effectiveDate": {
                            "type": "string",
                            "description": "(Apenas pix) Data de efetivação do estorno",
                            "format": "date-time",
                            "example": "2024-10-19 10:19:06",
                            "deprecated": false
                          },
                          "transactionReceiptUrl": {
                            "type": "string",
                            "description": "Link do recibo da transação",
                            "deprecated": false,
                            "example": null
                          },
                          "refundedSplits": {
                            "type": "array",
                            "description": "Lista de splits estornados, se houver",
                            "deprecated": false,
                            "items": {
                              "type": "object",
                              "properties": {
                                "id": {
                                  "type": "string",
                                  "description": "Identificador único do split",
                                  "example": "cff860dd-148e-48ca-ac8e-849684175158",
                                  "deprecated": false
                                },
                                "value": {
                                  "type": "number",
                                  "description": "Valor estornado",
                                  "example": 10,
                                  "deprecated": false
                                },
                                "done": {
                                  "type": "boolean",
                                  "description": "Indica se o split foi estornado",
                                  "example": true,
                                  "deprecated": false
                                }
                              },
                              "description": "Lista de splits estornados, se houver",
                              "deprecated": false,
                              "x-readme-ref-name": "PaymentRefundedSplitResponseDTO"
                            }
                          }
                        },
                        "description": "Informações de estorno",
                        "deprecated": false,
                        "x-readme-ref-name": "PaymentRefundGetResponseDTO"
                      }
                    }
                  },
                  "x-readme-ref-name": "PaymentGetResponseDTO"
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
          "404": {
            "description": "Not found"
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