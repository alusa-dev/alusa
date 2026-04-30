# Recuperar dados comerciais

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
    "/v3/myAccount/commercialInfo/": {
      "get": {
        "tags": [
          "Informações e personalização da conta"
        ],
        "summary": "Recuperar dados comerciais",
        "description": "",
        "operationId": "recuperar-dados-comerciais",
        "responses": {
          "200": {
            "description": "Ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "status": {
                      "type": "string",
                      "description": "Situação da conta",
                      "example": "APPROVED",
                      "deprecated": false,
                      "enum": [
                        "APPROVED",
                        "AWAITING_ACTION_AUTHORIZATION",
                        "DENIED",
                        "PENDING"
                      ],
                      "x-readme-ref-name": "AccountInfoGetResponseStatus"
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
                      "x-readme-ref-name": "AccountInfoGetResponsePersonType"
                    },
                    "cpfCnpj": {
                      "type": "string",
                      "description": "CPF ou CNPJ do proprietário da conta",
                      "example": "66625514000140",
                      "deprecated": false
                    },
                    "name": {
                      "type": "string",
                      "description": "Nome do proprietário da conta",
                      "example": "John Doe",
                      "deprecated": false
                    },
                    "birthDate": {
                      "type": "string",
                      "description": "Data de nascimento necessária caso as informações forem de pessoa física",
                      "format": "date",
                      "example": "1995-04-12",
                      "deprecated": false
                    },
                    "companyName": {
                      "type": "string",
                      "description": "Nome da empresa",
                      "deprecated": false,
                      "example": null
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
                      "x-readme-ref-name": "AccountInfoGetResponseCompanyType"
                    },
                    "incomeValue": {
                      "type": "number",
                      "description": "Faturamento/Renda mensal",
                      "example": 250000,
                      "deprecated": false
                    },
                    "email": {
                      "type": "string",
                      "description": "E-mail da conta",
                      "example": "john.doe@asaas.com.br",
                      "deprecated": false
                    },
                    "phone": {
                      "type": "string",
                      "description": "Telefone",
                      "deprecated": false,
                      "example": null
                    },
                    "mobilePhone": {
                      "type": "string",
                      "description": "Telefone Celular",
                      "deprecated": false,
                      "example": null
                    },
                    "postalCode": {
                      "type": "string",
                      "description": "CEP do endereço",
                      "example": "89223005",
                      "deprecated": false
                    },
                    "address": {
                      "type": "string",
                      "description": "Logradouro",
                      "example": "Av. Rolf Wiest",
                      "deprecated": false
                    },
                    "addressNumber": {
                      "type": "string",
                      "description": "Número do endereço",
                      "example": "659",
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
                      "example": "Bom retiro",
                      "deprecated": false
                    },
                    "city": {
                      "type": "object",
                      "properties": {
                        "object": {
                          "type": "string",
                          "description": "Tipo de objeto",
                          "example": "city",
                          "deprecated": false
                        },
                        "id": {
                          "type": "integer",
                          "description": "Identificador único da cidade no Asaas",
                          "format": "int32",
                          "example": 13660,
                          "deprecated": false
                        },
                        "ibgeCode": {
                          "type": "string",
                          "description": "Código do IBGE",
                          "example": "4209102",
                          "deprecated": false
                        },
                        "name": {
                          "type": "string",
                          "description": "Nome da cidade",
                          "example": "Joinville",
                          "deprecated": false
                        },
                        "districtCode": {
                          "type": "string",
                          "description": "Código do distrito",
                          "example": "05",
                          "deprecated": false
                        },
                        "district": {
                          "type": "string",
                          "description": "Nome do distrito",
                          "example": "Joinville",
                          "deprecated": false
                        },
                        "state": {
                          "type": "string",
                          "description": "Sigla do Estado (SP, RJ, SC, ...)",
                          "example": "SC",
                          "deprecated": false,
                          "enum": [
                            "AC",
                            "AL",
                            "AP",
                            "AM",
                            "BA",
                            "CE",
                            "DF",
                            "ES",
                            "GO",
                            "MA",
                            "MT",
                            "MS",
                            "MG",
                            "PA",
                            "PB",
                            "PR",
                            "PE",
                            "PI",
                            "RR",
                            "RO",
                            "RJ",
                            "RN",
                            "RS",
                            "SC",
                            "SP",
                            "SE",
                            "TO"
                          ],
                          "x-readme-ref-name": "AccountInfoCityState"
                        }
                      },
                      "description": "Informações da cidade cadastrada em sua conta",
                      "deprecated": false,
                      "x-readme-ref-name": "AccountInfoCityDTO"
                    },
                    "denialReason": {
                      "type": "string",
                      "description": "Motivo pelo qual é necessário reenviar as informações",
                      "deprecated": false,
                      "example": null
                    },
                    "tradingName": {
                      "type": "string",
                      "description": "Nome de exibição (preenchido automaticamente)",
                      "deprecated": false,
                      "example": null
                    },
                    "site": {
                      "type": "string",
                      "description": "Website",
                      "deprecated": false,
                      "example": null
                    },
                    "availableCompanyNames": {
                      "type": "array",
                      "description": "Nomes de empresa disponíveis. Preenchido apenas para contas do tipo Pessoa Jurídica(PJ).",
                      "example": [
                        "ASAAS GESTAO FINANCEIRA S.A.",
                        "ASAAS"
                      ],
                      "deprecated": false,
                      "items": {
                        "type": "string",
                        "description": "Nomes de empresa disponíveis. Preenchido apenas para contas do tipo Pessoa Jurídica(PJ).",
                        "example": [
                          "ASAAS GESTAO FINANCEIRA S.A.",
                          "ASAAS"
                        ],
                        "deprecated": false
                      }
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
                    }
                  },
                  "x-readme-ref-name": "AccountInfoGetResponseDTO"
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