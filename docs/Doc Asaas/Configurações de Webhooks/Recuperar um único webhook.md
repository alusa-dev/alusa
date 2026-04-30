# Recuperar um único webhook

Este endpoint recupera um único webhook de acordo com o ID informado.

Este endpoint recupera um único webhook de acordo com o ID informado.

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
      "name": "Configurações de Webhooks"
    }
  ],
  "paths": {
    "/v3/webhooks/{id}": {
      "get": {
        "tags": [
          "Configurações de Webhooks"
        ],
        "summary": "Recuperar um único webhook",
        "description": "Este endpoint recupera um único webhook de acordo com o ID informado.",
        "operationId": "recuperar-um-unico-webhook",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "description": "Identificador único do webhook",
            "required": true,
            "schema": {
              "type": "string",
              "example": "bbf67496-1379-4b6d-a348-fd5fa229f1c"
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
                    "id": {
                      "type": "string",
                      "description": "Identificador único do Webhook",
                      "example": "bbf67496-1379-4b6d-a348-fd5fa229f1c",
                      "deprecated": false
                    },
                    "name": {
                      "type": "string",
                      "description": "Nome do Webhook",
                      "example": "Nome Exemplo",
                      "deprecated": false
                    },
                    "url": {
                      "type": "string",
                      "description": "URL do Webhook",
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
                      "description": "Indica se o Webhook está ativo",
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
                    "hasAuthToken": {
                      "type": "boolean",
                      "description": "Indica se existe um token de autenticação registrado para o webhook",
                      "example": true,
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
                      "x-readme-ref-name": "WebhookConfigGetResponseWebhookSendType"
                    },
                    "penalizedRequestsCount": {
                      "type": "integer",
                      "description": "Quantidade de requests penalizados",
                      "format": "int32",
                      "example": 0,
                      "deprecated": false
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
                        "x-readme-ref-name": "WebhookConfigGetResponseWebhookEvent"
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
                  "x-readme-ref-name": "WebhookConfigGetResponseDTO"
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