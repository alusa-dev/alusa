# Recuperar uma única subconta

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
    "/v3/accounts/{id}": {
      "get": {
        "tags": [
          "Subcontas Asaas"
        ],
        "summary": "Recuperar uma única subconta",
        "description": "",
        "operationId": "recuperar-uma-unica-subconta",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "description": "Identificador único da subconta no Asaas",
            "required": true,
            "schema": {
              "type": "string",
              "example": "4f468235-cec3-482f-b3d0-348af4c7194"
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