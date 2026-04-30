# Verificar documentos pendentes

### Guia de White label

[Confira o guia de white label para mais informações.](https://docs.asaas.com/docs/sobre-white-label)

Para recuperar os documentos pendentes e ter acesso ao `onboardingUrl` dos mesmos.

> 🚧 Atenção
>
> **Após criar uma subconta, defina um time out de 15 segundos antes de realizar a chamada pra este endpoint.**
>
> Caso a chamada para verificar os documentos subsequentes seja feita em sequência a criação da conta, você provavelmente será informado de que documentos não obrigatórios sejam enviados pois a criação e validação da conta com a receita federal ainda não foi concluída.
>
> O tempo é necessário apenas para a validação, captação de dados necessários e criação da conta.

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
      "name": "Envio de documentos White Label"
    }
  ],
  "paths": {
    "/v3/myAccount/documents": {
      "get": {
        "tags": [
          "Envio de documentos White Label"
        ],
        "summary": "Verificar documentos pendentes",
        "description": "",
        "operationId": "verificar-documentos-pendentes",
        "responses": {
          "200": {
            "description": "Ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "rejectReasons": {
                      "type": "string",
                      "description": "Razão pela qual a aprovação da conta foi rejeitada",
                      "deprecated": false,
                      "example": null
                    },
                    "data": {
                      "type": "array",
                      "description": "Lista de objetos",
                      "deprecated": false,
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string",
                            "description": "Identificador único do grupo de documentos no Asaas",
                            "example": "172ed152-4fa4-43ad-9b69-39c323e9526c",
                            "deprecated": false
                          },
                          "status": {
                            "type": "string",
                            "description": "Status do grupo de documentos",
                            "example": "NOT_SENT",
                            "deprecated": false,
                            "enum": [
                              "NOT_SENT",
                              "PENDING",
                              "APPROVED",
                              "REJECTED",
                              "IGNORED"
                            ],
                            "x-readme-ref-name": "AccountDocumentGroupResponseAccountDocumentStatus"
                          },
                          "type": {
                            "type": "string",
                            "description": "Tipo de documentos",
                            "example": "MINUTES_OF_CONSTITUTION",
                            "deprecated": false,
                            "enum": [
                              "ALLOW_BANK_ACCOUNT_DEPOSIT_STATEMENT",
                              "CUSTOM",
                              "EMANCIPATION_OF_MINORS",
                              "ENTREPRENEUR_REQUIREMENT",
                              "IDENTIFICATION_SELFIE",
                              "IDENTIFICATION",
                              "INVOICE",
                              "MEI_CERTIFICATE",
                              "MINUTES_OF_CONSTITUTION",
                              "MINUTES_OF_ELECTION",
                              "POWER_OF_ATTORNEY",
                              "SOCIAL_CONTRACT"
                            ],
                            "x-readme-ref-name": "AccountDocumentGroupResponseAccountDocumentType"
                          },
                          "title": {
                            "type": "string",
                            "description": "Título do grupo de documentos",
                            "example": "Ata de eleição da última diretoria",
                            "deprecated": false
                          },
                          "description": {
                            "type": "string",
                            "description": "Descrição",
                            "example": "Não possui descrição",
                            "deprecated": false
                          },
                          "responsible": {
                            "type": "object",
                            "properties": {
                              "name": {
                                "type": "string",
                                "description": "Nome do responsável",
                                "example": "John Doe",
                                "deprecated": false
                              },
                              "type": {
                                "type": "array",
                                "description": "Tipo de responsável",
                                "example": "ASSOCIATION",
                                "deprecated": false,
                                "items": {
                                  "type": "string",
                                  "description": "Tipo de responsável",
                                  "example": "ASSOCIATION",
                                  "deprecated": false,
                                  "enum": [
                                    "ALLOW_BANK_ACCOUNT_DEPOSIT_STATEMENT",
                                    "ASAAS_ACCOUNT_OWNER_EMANCIPATION_AGE",
                                    "ASAAS_ACCOUNT_OWNER",
                                    "ASSOCIATION",
                                    "BANK_ACCOUNT_OWNER_EMANCIPATION_AGE",
                                    "BANK_ACCOUNT_OWNER",
                                    "CUSTOM",
                                    "DIRECTOR",
                                    "INDIVIDUAL_COMPANY",
                                    "LIMITED_COMPANY",
                                    "MEI",
                                    "PARTNER",
                                    "POWER_OF_ATTORNEY"
                                  ],
                                  "x-readme-ref-name": "AccountDocumentResponsibleResponseAccountDocumentResponsibleType"
                                },
                                "enum": [
                                  "ALLOW_BANK_ACCOUNT_DEPOSIT_STATEMENT",
                                  "ASAAS_ACCOUNT_OWNER_EMANCIPATION_AGE",
                                  "ASAAS_ACCOUNT_OWNER",
                                  "ASSOCIATION",
                                  "BANK_ACCOUNT_OWNER_EMANCIPATION_AGE",
                                  "BANK_ACCOUNT_OWNER",
                                  "CUSTOM",
                                  "DIRECTOR",
                                  "INDIVIDUAL_COMPANY",
                                  "LIMITED_COMPANY",
                                  "MEI",
                                  "PARTNER",
                                  "POWER_OF_ATTORNEY"
                                ]
                              }
                            },
                            "description": "Quem são os responsáveis pelo envio desses documentos",
                            "deprecated": false,
                            "x-readme-ref-name": "AccountDocumentResponsibleResponseDTO"
                          },
                          "onboardingUrl": {
                            "type": "string",
                            "description": "URL para envio dos documentos",
                            "example": "https://example.com/cadastro.io/8ad196d6cbfcc5d05bfabcbb5c730f6a",
                            "deprecated": false
                          },
                          "onboardingUrlExpirationDate": {
                            "type": "string",
                            "description": "Data de expiração da URL de envio dos documentos",
                            "format": "date-time",
                            "example": "2025-03-04 00:00:00",
                            "deprecated": false
                          },
                          "documents": {
                            "type": "array",
                            "description": "Os documentos que já foram enviados com seus respectivos identificadores",
                            "deprecated": false,
                            "items": {
                              "type": "object",
                              "properties": {
                                "id": {
                                  "type": "string",
                                  "description": "Identificador único do documento no Asaas",
                                  "example": "8d257732-2220-11ec-b695-b6af4a64184d",
                                  "deprecated": false
                                },
                                "status": {
                                  "type": "string",
                                  "description": "Status da aprovação do documento",
                                  "example": "PENDING",
                                  "deprecated": false,
                                  "enum": [
                                    "NOT_SENT",
                                    "PENDING",
                                    "APPROVED",
                                    "REJECTED"
                                  ],
                                  "x-readme-ref-name": "AccountDocumentGetResponseAccountDocumentStatus"
                                }
                              },
                              "x-readme-ref-name": "AccountDocumentGetResponseDTO"
                            }
                          }
                        },
                        "description": "Lista de objetos",
                        "deprecated": false,
                        "x-readme-ref-name": "AccountDocumentGroupResponseDTO"
                      }
                    }
                  },
                  "x-readme-ref-name": "AccountDocumentShowResponseDTO"
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