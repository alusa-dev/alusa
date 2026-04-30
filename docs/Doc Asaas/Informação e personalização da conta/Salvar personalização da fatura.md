# Salvar personalização da fatura

Possibilita personalizar a fatura que é apresentada ao seu cliente com o logo e cores da sua empresa. Após salva, a personalização é analisada e aprovada pela nossa equipe dentro de algumas horas.

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
    "/v3/myAccount/paymentCheckoutConfig/": {
      "post": {
        "tags": [
          "Informações e personalização da conta"
        ],
        "summary": "Salvar personalização da fatura",
        "description": "",
        "operationId": "salvar-personalizacao-da-fatura",
        "parameters": [],
        "requestBody": {
          "content": {
            "multipart/form-data": {
              "schema": {
                "required": [
                  "logoBackgroundColor",
                  "infoBackgroundColor",
                  "fontColor"
                ],
                "type": "object",
                "properties": {
                  "logoBackgroundColor": {
                    "type": "string",
                    "description": "Cor de fundo do logo",
                    "nullable": false,
                    "example": "#00ff00",
                    "deprecated": false
                  },
                  "infoBackgroundColor": {
                    "type": "string",
                    "description": "Cor de fundo das suas informações",
                    "nullable": false,
                    "example": "#000fff",
                    "deprecated": false
                  },
                  "fontColor": {
                    "type": "string",
                    "description": "Cor da fonte das suas informações",
                    "nullable": false,
                    "example": "#00ff0",
                    "deprecated": false
                  },
                  "enabled": {
                    "type": "boolean",
                    "description": "Indica se a personalização está habilitada",
                    "example": true,
                    "deprecated": false
                  },
                  "logoFile": {
                    "type": "string",
                    "description": "Arquivo",
                    "format": "binary",
                    "nullable": false,
                    "deprecated": false,
                    "example": null,
                    "x-readme-ref-name": "File"
                  }
                },
                "x-readme-ref-name": "PaymentCheckoutConfigSaveRequestDTO"
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
                      "example": "paymentCheckoutConfig",
                      "deprecated": false
                    },
                    "logoBackgroundColor": {
                      "type": "string",
                      "description": "Cor de fundo do logo",
                      "example": "#00ff00",
                      "deprecated": false
                    },
                    "infoBackgroundColor": {
                      "type": "string",
                      "description": "Cor de fundo das suas informações",
                      "example": "#000fff",
                      "deprecated": false
                    },
                    "fontColor": {
                      "type": "string",
                      "description": "Cor da fonte das suas informações",
                      "example": "#00ff00",
                      "deprecated": false
                    },
                    "enabled": {
                      "type": "boolean",
                      "description": "Indica se a personalização está habilitada",
                      "example": true,
                      "deprecated": false,
                      "default": true
                    },
                    "logoUrl": {
                      "type": "string",
                      "description": "Link para download da logo",
                      "deprecated": false,
                      "example": null
                    },
                    "observations": {
                      "type": "string",
                      "description": "Observações da análise de personalização da fatura",
                      "example": "Aprovado automaticamente pelo sistema.",
                      "deprecated": false
                    },
                    "status": {
                      "type": "string",
                      "description": "Situação da personalização da fatura",
                      "example": "APPROVED",
                      "deprecated": false,
                      "enum": [
                        "AWAITING_APPROVAL",
                        "APPROVED",
                        "REJECTED"
                      ],
                      "x-readme-ref-name": "PaymentCheckoutConfigGetResponseInvoiceConfigStatus"
                    }
                  },
                  "x-readme-ref-name": "PaymentCheckoutConfigGetResponseDTO"
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