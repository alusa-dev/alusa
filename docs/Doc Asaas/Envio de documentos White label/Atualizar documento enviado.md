# Atualizar documento enviado

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
    "/v3/myAccount/documents/files/{id}": {
      "post": {
        "tags": [
          "Envio de documentos White Label"
        ],
        "summary": "Atualizar documento enviado",
        "description": "",
        "operationId": "atualizar-documento-enviado",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "description": "Identificador único do documento no Asaas",
            "required": true,
            "schema": {
              "type": "string",
              "example": "8d257732-2220-11ec-b695-b6af4a64184d"
            }
          }
        ],
        "requestBody": {
          "content": {
            "multipart/form-data": {
              "schema": {
                "required": [
                  "documentFile"
                ],
                "type": "object",
                "properties": {
                  "documentFile": {
                    "type": "string",
                    "description": "Arquivo",
                    "format": "binary",
                    "nullable": false,
                    "deprecated": false,
                    "example": null,
                    "x-readme-ref-name": "File"
                  }
                },
                "x-readme-ref-name": "AccountDocumentUpdateRequestDTO"
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