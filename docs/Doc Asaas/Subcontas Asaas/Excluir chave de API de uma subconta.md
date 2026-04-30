# Excluir chave de API de uma subconta

<Callout icon="🚧" theme="warn">
  **Atenção**

  * Esse endpoint necessita de liberação via interface WEB. Para mais detalhes sobre a liberação acesse nosso guia sobre [gerenciamento das chaves de API de subcontas](https://docs.asaas.com/update/docs/gerenciamento-de-chaves-de-api-de-subcontas#/).
  * Ele só pode ser acessado por seu sistema e caso você tenha a configuração de Whitelist de IPs habilitada. Confira mais detalhes sobre a funcionalidade de [Whitelist de IPs](https://docs.asaas.com/docs/mecanismos-de-seguranca#/whitelist-de-ips).
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
      "name": "Subcontas Asaas"
    }
  ],
  "paths": {
    "/v3/accounts/{id}/accessTokens/{accessTokenId}": {
      "delete": {
        "tags": [
          "Subcontas Asaas"
        ],
        "summary": "Excluir chave de API de uma subconta",
        "description": "",
        "operationId": "excluir-chave-de-api-de-uma-subconta",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "description": "Identificador único da subconta no Asaas",
            "required": true,
            "schema": {
              "type": "string",
              "example": "b6bff0c5-38c6-496a-a3a8-105b31d5bcfe"
            }
          },
          {
            "name": "accessTokenId",
            "in": "path",
            "description": "ID da chave de API",
            "required": true,
            "schema": {
              "type": "string",
              "example": "279baa3b-2cfd-4d41-b04b-e3299ae4b645"
            }
          }
        ],
        "responses": {
          "204": {
            "description": "No Content"
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