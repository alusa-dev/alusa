# Listar clientes

Diferente da recuperação de um cliente específico, este método retorna uma lista paginada com todos os clientes para os filtros informados.

Filtrar por nome:

`GET https://api.asaas.com/v3/customers?name=Marcelo`

Filtrar por CPF ou CNPJ:

`GET https://api.asaas.com/v3/customers?cpfCnpj=42885229519`

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
      "name": "Clientes"
    }
  ],
  "paths": {
    "/v3/customers": {
      "get": {
        "tags": [
          "Clientes"
        ],
        "summary": "Listar clientes",
        "description": "",
        "operationId": "listar-clientes",
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
            "name": "name",
            "in": "query",
            "description": "Filtrar por nome",
            "schema": {
              "type": "string",
              "example": "John Doe"
            }
          },
          {
            "name": "email",
            "in": "query",
            "description": "Filtrar por email",
            "schema": {
              "type": "string",
              "example": "john.doe@asaas.com.br"
            }
          },
          {
            "name": "cpfCnpj",
            "in": "query",
            "description": "Filtrar por CPF ou CNPJ",
            "schema": {
              "type": "string",
              "example": "24971563792"
            }
          },
          {
            "name": "groupName",
            "in": "query",
            "description": "Filtrar por grupo",
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
                            "description": "Tipo de objeto",
                            "example": "customer",
                            "deprecated": false
                          },
                          "id": {
                            "type": "string",
                            "description": "Identificador único do cliente no Asaas",
                            "example": "cus_000005401844",
                            "deprecated": false
                          },
                          "dateCreated": {
                            "type": "string",
                            "description": "Data de criação do cliente",
                            "example": "2024-07-12",
                            "deprecated": false
                          },
                          "name": {
                            "type": "string",
                            "description": "Nome do cliente",
                            "example": "John Doe",
                            "deprecated": false
                          },
                          "email": {
                            "type": "string",
                            "description": "E-mail do cliente",
                            "example": "john.doe@asaas.com.br",
                            "deprecated": false
                          },
                          "phone": {
                            "type": "string",
                            "description": "Telefone do cliente",
                            "example": "90999999999",
                            "deprecated": false
                          },
                          "mobilePhone": {
                            "type": "string",
                            "description": "Celular do cliente",
                            "example": "90999999999",
                            "deprecated": false
                          },
                          "address": {
                            "type": "string",
                            "description": "Endereço do cliente",
                            "example": "Av. Paulista",
                            "deprecated": false
                          },
                          "addressNumber": {
                            "type": "string",
                            "description": "Número do endereço do cliente",
                            "example": "150",
                            "deprecated": false
                          },
                          "complement": {
                            "type": "string",
                            "description": "Complemento do endereço do cliente",
                            "example": "Sala 201",
                            "deprecated": false
                          },
                          "province": {
                            "type": "string",
                            "description": "Bairro do endereço do cliente",
                            "example": "Centro",
                            "deprecated": false
                          },
                          "city": {
                            "type": "integer",
                            "description": "Identificador único da cidade no Asaas",
                            "format": "int32",
                            "example": 12565,
                            "deprecated": false
                          },
                          "cityName": {
                            "type": "string",
                            "description": "Cidade do endereço do cliente",
                            "example": "São Paulo",
                            "deprecated": false
                          },
                          "state": {
                            "type": "string",
                            "description": "Estado do endereço do cliente",
                            "example": "SP",
                            "deprecated": false
                          },
                          "country": {
                            "type": "string",
                            "description": "País do cliente",
                            "example": "Brasil",
                            "deprecated": false
                          },
                          "postalCode": {
                            "type": "string",
                            "description": "CEP do endereço do cliente",
                            "example": "01310000",
                            "deprecated": false
                          },
                          "cpfCnpj": {
                            "type": "string",
                            "description": "CPF ou CNPJ do cliente",
                            "example": "24971563792",
                            "deprecated": false
                          },
                          "personType": {
                            "type": "string",
                            "description": "Tipo de pessoa",
                            "example": "FISICA",
                            "deprecated": false,
                            "enum": [
                              "JURIDICA",
                              "FISICA"
                            ],
                            "x-readme-ref-name": "CustomerGetResponsePersonType"
                          },
                          "deleted": {
                            "type": "boolean",
                            "description": "Indica se é um cliente deletado",
                            "example": false,
                            "deprecated": false
                          },
                          "additionalEmails": {
                            "type": "string",
                            "description": "E-mails adicionais do cliente",
                            "example": "john.doe@asaas.com,john.doe.silva@asaas.com.br",
                            "deprecated": false
                          },
                          "externalReference": {
                            "type": "string",
                            "description": "Referência externa do cliente",
                            "example": "12987382",
                            "deprecated": false
                          },
                          "notificationDisabled": {
                            "type": "boolean",
                            "description": "Indica se as notificações estão desabilitadas",
                            "example": false,
                            "deprecated": false
                          },
                          "observations": {
                            "type": "string",
                            "description": "Observações do cliente",
                            "example": "ótimo pagador, nenhum problema até o momento",
                            "deprecated": false
                          },
                          "foreignCustomer": {
                            "type": "boolean",
                            "description": "indica se o pagador é estrangeiro",
                            "example": false,
                            "deprecated": false
                          }
                        },
                        "x-readme-ref-name": "CustomerGetResponseDTO"
                      }
                    }
                  },
                  "x-readme-ref-name": "CustomerListResponseDTO"
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