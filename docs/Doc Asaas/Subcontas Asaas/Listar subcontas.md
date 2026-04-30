# Listar subcontas

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
    "/v3/accounts": {
      "get": {
        "tags": [
          "Subcontas Asaas"
        ],
        "summary": "Listar subcontas",
        "description": "",
        "operationId": "listar-subcontas",
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
            "name": "cpfCnpj",
            "in": "query",
            "description": "Filtrar pelo cpf ou cnpj da subconta",
            "schema": {
              "type": "string",
              "example": null
            }
          },
          {
            "name": "email",
            "in": "query",
            "description": "Filtrar pelo email da subconta",
            "schema": {
              "type": "string",
              "example": null
            }
          },
          {
            "name": "name",
            "in": "query",
            "description": "Filtrar pelo nome da subconta",
            "schema": {
              "type": "string",
              "example": null
            }
          },
          {
            "name": "walletId",
            "in": "query",
            "description": "Filtrar pelo walletId da subconta",
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
                            "example": "account",
                            "deprecated": false
                          },
                          "id": {
                            "type": "string",
                            "description": "Identificador único da subconta no Asaas",
                            "example": "4f468235-cec3-482f-b3d0-348af4c7194",
                            "deprecated": false
                          },
                          "name": {
                            "type": "string",
                            "description": "Nome da subconta",
                            "example": "John Doe",
                            "deprecated": false
                          },
                          "email": {
                            "type": "string",
                            "description": "Email da subconta",
                            "example": "john.doe@asaas.com.br",
                            "deprecated": false
                          },
                          "loginEmail": {
                            "type": "string",
                            "description": "Email para login da subconta, caso não informado será utilizado o email da subconta",
                            "example": "john.doe@asaas.com.br",
                            "deprecated": false
                          },
                          "phone": {
                            "type": "string",
                            "description": "Telefone Fixo",
                            "deprecated": false,
                            "example": null
                          },
                          "mobilePhone": {
                            "type": "string",
                            "description": "Telefone Celular",
                            "deprecated": false,
                            "example": null
                          },
                          "address": {
                            "type": "string",
                            "description": "Logradouro",
                            "example": "Rua Fernando Orlandi",
                            "deprecated": false
                          },
                          "addressNumber": {
                            "type": "string",
                            "description": "Número do endereço",
                            "example": "544",
                            "deprecated": false
                          },
                          "complement": {
                            "type": "string",
                            "description": "Complemento do endereço",
                            "deprecated": false,
                            "example": null
                          },
                          "province": {
                            "type": "string",
                            "description": "Bairro",
                            "example": "Jardim Pedra Branca",
                            "deprecated": false
                          },
                          "postalCode": {
                            "type": "string",
                            "description": "CEP do endereço",
                            "example": "14079-452",
                            "deprecated": false
                          },
                          "cpfCnpj": {
                            "type": "string",
                            "description": "CPF ou CNPJ do proprietário da subconta",
                            "example": "35381637000150",
                            "deprecated": false
                          },
                          "birthDate": {
                            "type": "string",
                            "description": "Data de nascimento (somente quando Pessoa Física)",
                            "format": "date",
                            "example": "1995-04-12",
                            "deprecated": false
                          },
                          "personType": {
                            "type": "string",
                            "description": "Tipo de Pessoa",
                            "example": "JURIDICA",
                            "deprecated": false,
                            "enum": [
                              "JURIDICA",
                              "FISICA"
                            ],
                            "x-readme-ref-name": "AccountGetResponsePersonType"
                          },
                          "companyType": {
                            "type": "string",
                            "description": "Tipo da empresa (somente quando Pessoa Jurídica)",
                            "example": "MEI",
                            "deprecated": false,
                            "enum": [
                              "MEI",
                              "LIMITED",
                              "INDIVIDUAL",
                              "ASSOCIATION"
                            ],
                            "x-readme-ref-name": "AccountGetResponseCompanyType"
                          },
                          "city": {
                            "type": "integer",
                            "description": "Identificador único da cidade no Asaas",
                            "format": "int32",
                            "example": 15478,
                            "deprecated": false
                          },
                          "state": {
                            "type": "string",
                            "description": "Sigla do Estado (SP, RJ, SC, ...)",
                            "example": "SP",
                            "deprecated": false
                          },
                          "country": {
                            "type": "string",
                            "description": "País (Fixo Brasil)",
                            "example": "Brasil",
                            "deprecated": false
                          },
                          "tradingName": {
                            "type": "string",
                            "description": "Nome de exibição (preenchido automaticamente)",
                            "deprecated": false,
                            "example": null
                          },
                          "site": {
                            "type": "string",
                            "description": "URL of the subbacount website",
                            "example": "https://www.example.com",
                            "deprecated": false
                          },
                          "walletId": {
                            "type": "string",
                            "description": "Unique wallet identifier to split charges or transfer between Asaas accounts",
                            "example": "c0c1688f-636b-42c0-b6ee-7339182276b7",
                            "deprecated": false
                          },
                          "accountNumber": {
                            "type": "object",
                            "properties": {
                              "agency": {
                                "type": "string",
                                "description": "Account agency",
                                "example": "0001",
                                "deprecated": false
                              },
                              "account": {
                                "type": "string",
                                "description": "Account number",
                                "example": "3514",
                                "deprecated": false
                              },
                              "accountDigit": {
                                "type": "string",
                                "description": "Account digit",
                                "example": "3",
                                "deprecated": false
                              }
                            },
                            "description": "Subaccount number in Asaas",
                            "deprecated": false,
                            "x-readme-ref-name": "AccountNumberDTO"
                          },
                          "commercialInfoExpiration": {
                            "type": "object",
                            "properties": {
                              "isExpired": {
                                "type": "boolean",
                                "description": "Informa se os dados comerciais estão expirados",
                                "example": false,
                                "deprecated": false
                              },
                              "scheduledDate": {
                                "type": "string",
                                "description": "Informa a data de expiração dos dados comerciais",
                                "format": "date-time",
                                "example": "2025-05-05 00:00:00",
                                "deprecated": false
                              }
                            },
                            "description": "Informações sobre a expiração dos dados comerciais",
                            "deprecated": false,
                            "x-readme-ref-name": "AccountInfoCommercialInfoExpirationResponseDTO"
                          },
                          "accessToken": {
                            "type": "object",
                            "properties": {
                              "id": {
                                "type": "string",
                                "description": "ID da chave de API",
                                "example": "b6bff0c5-38c6-496a-a3a8-105b31d5bcfe",
                                "deprecated": false
                              },
                              "name": {
                                "type": "string",
                                "description": "Nome da chave de API",
                                "example": "My API Access Token",
                                "deprecated": false
                              },
                              "enabled": {
                                "type": "boolean",
                                "description": "Indica se a chave de API está habilitada",
                                "example": false,
                                "deprecated": false
                              },
                              "expirationDate": {
                                "type": "string",
                                "description": "Data de expiração da chave de API",
                                "format": "date-time",
                                "example": "2026-12-31 12:30:50",
                                "deprecated": false
                              },
                              "dateCreated": {
                                "type": "string",
                                "description": "Data de criação da chave de API",
                                "format": "date-time",
                                "example": "2026-01-01 08:00:00",
                                "deprecated": false
                              },
                              "projectedExpirationDateByLackOfUse": {
                                "type": "string",
                                "description": "Data prevista de expiração por falta de uso da chave de API",
                                "format": "date",
                                "example": "2026-06-01",
                                "deprecated": false
                              }
                            },
                            "x-readme-ref-name": "CustomerApiAccessTokenBaseResponseDTO"
                          }
                        },
                        "x-readme-ref-name": "AccountGetResponseDTO"
                      }
                    }
                  },
                  "x-readme-ref-name": "AccountListResponseDTO"
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