# Excluir subconta White Label

> ❗️ Atenção
>
> Só é permitido a exclusão via API de subcontas no formato White Label. Subcontas que tenham acesso a interface WEB/APP do Asaas devem seguir com a exclusão diretamente por essas interfaces.

> 🚧 Lembre-se
>
> Ao utilizar este endpoint você precisa realizar a chamada utilizando a chave de API da subconta que deseja excluir.

Ao excluir uma subconta no Asaas, ela perderá o acesso a todas as funcionalidades e todos os seus dados serão removidos, incluindo cobranças, clientes e documentos.

**Não será possível recuperar a conta após o cancelamento.**

Para excluir a subconta é necessário:

* Não possuir pendências no saldo
* Não possuir saques ou notas fiscais agendadas
* Não possuir cobranças pendentes
* Não possuir valores em aberto no Cartão de Crédito Asaas (Faturas abertas, fechadas ou futuras)
* Não possuir saldo no Cartão Pré-pago

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
    "/v3/myAccount/": {
      "delete": {
        "tags": [
          "Informações e personalização da conta"
        ],
        "summary": "Excluir subconta White Label",
        "description": "",
        "operationId": "excluir-subconta-white-label",
        "parameters": [
          {
            "name": "removeReason",
            "in": "query",
            "description": "Motivo da remoção",
            "schema": {
              "type": "string",
              "example": "Liberar dados"
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
                    "observations": {
                      "type": "string",
                      "description": "Informações sobre a exclusão",
                      "example": "Conta desabilitada com sucesso",
                      "deprecated": false
                    }
                  },
                  "x-readme-ref-name": "MyAccountDisableAccountResponseDTO"
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