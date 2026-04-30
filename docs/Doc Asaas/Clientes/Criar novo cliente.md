# Criar novo cliente

### Guia de Clientes

[Confira o guia de clientes para mais informações.](https://docs.asaas.com/docs/criando-um-cliente)

Para que seja possível criar uma cobrança, antes é necessário criar o cliente ao qual ela irá pertencer. Você deve utilizar o ID retornado nesta requisição na criação da cobrança.

Caso você envie o `postalCode` do cliente, não é necessário enviar os atributos `city`, `province` e `address`, pois o Asaas preencherá estas informações automaticamente com base no CEP que você informou. Nestes casos basta enviar somente `postalCode` e `addressNumber`.

No campo `city` é retornado um identificador. Caso você queira obter o nome e demais informações da cidade você deve fazer a seguinte requisição utilizando esse identificador:\
`GET https://api.asaas.com/v3/cities/{city_id}`

> 🚧 Atenção
>
> O sistema permite a criação de clientes duplicados. Portanto, se você não quiser permitir é necessário implementar a validação antes de realizar a criação do cliente. Você pode consultar a existência do cliente no [Listar Clientes](https://docs.asaas.com/reference/listar-clientes).

> 📘
>
> **Produção:** Caso seu cliente seja estrangeiro, será necessário entrar em contato com seu Gerente de Contas para que ele solicite a liberação em seu cadastro de criação de clientes estrangeiros.
>
> **Sandbox:** Em sandbox é possível gerar clientes estrangeiros sem liberação prévia.

> 🚧 Importante
>
> O envio e recebimento de notificações de email e SMS funcionam normalmente em Sandbox. **Portanto você não deve criar clientes com emails e celulares reais ou números aleatórios como (51) 9999-9999**. Para testar o recebimento de notificações você pode utilizar os seus próprios emails e celulares.

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
      "post": {
        "tags": [
          "Clientes"
        ],
        "summary": "Criar novo cliente",
        "description": "",
        "operationId": "criar-novo-cliente",
        "parameters": [],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "name",
                  "cpfCnpj"
                ],
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "Nome do cliente",
                    "nullable": false,
                    "example": "John Doe",
                    "deprecated": false
                  },
                  "cpfCnpj": {
                    "type": "string",
                    "description": "CPF ou CNPJ do cliente",
                    "nullable": false,
                    "example": "24971563792",
                    "deprecated": false
                  },
                  "email": {
                    "type": "string",
                    "description": "Email do cliente",
                    "example": "john.doe@asaas.com.br",
                    "deprecated": false
                  },
                  "phone": {
                    "type": "string",
                    "description": "Fone fixo",
                    "example": "4738010919",
                    "deprecated": false
                  },
                  "mobilePhone": {
                    "type": "string",
                    "description": "Fone celular",
                    "example": "4799376637",
                    "deprecated": false
                  },
                  "address": {
                    "type": "string",
                    "description": "Logradouro",
                    "example": "Av. Paulista",
                    "deprecated": false
                  },
                  "addressNumber": {
                    "type": "string",
                    "description": "Número do endereço",
                    "example": "150",
                    "deprecated": false
                  },
                  "complement": {
                    "type": "string",
                    "description": "Complemento do endereço (máx. 255 caracteres)",
                    "example": "Sala 201",
                    "deprecated": false
                  },
                  "province": {
                    "type": "string",
                    "description": "Bairro",
                    "example": "Centro",
                    "deprecated": false
                  },
                  "postalCode": {
                    "type": "string",
                    "description": "CEP do endereço",
                    "example": "01310-000",
                    "deprecated": false
                  },
                  "externalReference": {
                    "type": "string",
                    "description": "Identificador do cliente no seu sistema",
                    "example": "12987382",
                    "deprecated": false
                  },
                  "notificationDisabled": {
                    "type": "boolean",
                    "description": "true para desabilitar o envio de notificações de cobrança",
                    "example": false,
                    "deprecated": false
                  },
                  "additionalEmails": {
                    "type": "string",
                    "description": "Emails adicionais para envio de notificações de cobrança separados por \",\"",
                    "example": "john.doe@asaas.com,john.doe.silva@asaas.com.br",
                    "deprecated": false
                  },
                  "municipalInscription": {
                    "type": "string",
                    "description": "Inscrição municipal do cliente",
                    "example": "46683695908",
                    "deprecated": false
                  },
                  "stateInscription": {
                    "type": "string",
                    "description": "Inscrição estadual do cliente",
                    "example": "646681195275",
                    "deprecated": false
                  },
                  "observations": {
                    "type": "string",
                    "description": "Observações adicionais",
                    "example": "ótimo pagador, nenhum problema até o momento",
                    "deprecated": false
                  },
                  "groupName": {
                    "type": "string",
                    "description": "Nome do grupo ao qual o cliente pertence",
                    "deprecated": false,
                    "example": null
                  },
                  "company": {
                    "type": "string",
                    "description": "Empresa",
                    "deprecated": false,
                    "example": null
                  },
                  "foreignCustomer": {
                    "type": "boolean",
                    "description": "informe true caso seja pagador estrangeiro",
                    "example": false,
                    "deprecated": false
                  }
                },
                "x-readme-ref-name": "CustomerSaveRequestDTO"
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