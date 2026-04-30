# Consultar situação cadastral da conta

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
* `AWAITING_APPROVAL` - É o status utilizado quando a conta está com todos os outros status aprovados, e a aprovação geral não pôde ser feita automaticamente. Estará na fila aguardando uma análise manual.

<Callout icon="📘" theme="info">
  A conta estará 100% aprovada quando o retorno do atributo `general` for *`APPROVED`*.
</Callout>

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
    "/v3/myAccount/status/": {
      "get": {
        "tags": [
          "Informações e personalização da conta"
        ],
        "summary": "Consultar situação cadastral da conta",
        "description": "",
        "operationId": "consultar-situacao-cadastral-da-conta",
        "parameters": [],
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
                      "description": "Identificador único da conta no Asaas",
                      "example": "a910f50b-8745-4bc6-89fe-f1931c6a2e05",
                      "deprecated": false
                    },
                    "commercialInfo": {
                      "type": "string",
                      "description": "Status dos dados comerciais enviados",
                      "example": "APPROVED",
                      "deprecated": false,
                      "enum": [
                        "PENDING",
                        "APPROVED",
                        "REJECTED",
                        "AWAITING_APPROVAL"
                      ],
                      "x-readme-ref-name": "MyAccountGetStatusResponseStatus"
                    },
                    "bankAccountInfo": {
                      "type": "string",
                      "description": "Status dos dados comerciais enviados",
                      "example": "APPROVED",
                      "deprecated": false,
                      "enum": [
                        "PENDING",
                        "APPROVED",
                        "REJECTED",
                        "AWAITING_APPROVAL"
                      ],
                      "x-readme-ref-name": "MyAccountGetStatusResponseStatus"
                    },
                    "documentation": {
                      "type": "string",
                      "description": "Status dos dados comerciais enviados",
                      "example": "APPROVED",
                      "deprecated": false,
                      "enum": [
                        "PENDING",
                        "APPROVED",
                        "REJECTED",
                        "AWAITING_APPROVAL"
                      ],
                      "x-readme-ref-name": "MyAccountGetStatusResponseStatus"
                    },
                    "general": {
                      "type": "string",
                      "description": "Status dos dados comerciais enviados",
                      "example": "APPROVED",
                      "deprecated": false,
                      "enum": [
                        "PENDING",
                        "APPROVED",
                        "REJECTED",
                        "AWAITING_APPROVAL"
                      ],
                      "x-readme-ref-name": "MyAccountGetStatusResponseStatus"
                    }
                  },
                  "x-readme-ref-name": "MyAccountGetStatusResponseDTO"
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