# Criar cobrança com cartão de crédito

### Guia de Cartão de crédito

[Confira o guia de cartão de crédito para mais informações.](https://docs.asaas.com/docs/cobrancas-via-cartao-de-credito)

Ao criar uma cobrança com a forma de pagamento cartão de crédito, é possível redirecionar o cliente para a URL da fatura (`invoiceUrl`) para que ele possa inserir os dados do seu cartão através da interface do Asaas, ou os dados do cartão e titular do cartão podem ser enviados na criação solicitação de processamento de pagamento imediato.

Para isso, ao executar a solicitação de criação de cobrança, basta enviar os dados do cartão de crédito juntamente com os dados do titular do cartão através dos objetos `creditCard` e `creditCardHolderInfo`. É essencial que os dados do titular do cartão correspondam exatamente aos registados no emissor do cartão; caso contrário, a transação poderá ser negada devido à suspeita de fraude.

Caso a transação seja autorizada, o faturamento será criado e o Asaas retornará `HTTP 200`. Caso contrário, o faturamento não será persistido e `HTTP 400` será retornado.

No `Sandbox`, as transações são aprovadas automaticamente. Para simular um erro, você precisa usar os números de cartão de crédito `5184019740373151 (Mastercard)` ou `4916561358240741 (Visa)`.

<br />

### Tokenização de cartão de crédito

* Ao realizar a primeira transação para o cliente com cartão de crédito, a resposta do Asaas retornará o atributo `creditCardToken`.
* Com essas informações, nas transações subsequentes, o atributo `creditCardToken` poderá substituir os objetos `creditCard` e `creditCardHolderInfo` e ser fornecido diretamente na raiz da solicitação, eliminando a necessidade de fornecer novamente os objetos.

> 🚧 Atenção
>
> * Independentemente da data de vencimento informada, a captura (cobrança no cartão do cliente) será feita no momento da criação da cobrança.
> * Caso opte por capturar os dados do cartão do cliente através da interface do seu sistema, o uso de SSL (HTTPS) é obrigatório; caso contrário, sua conta poderá ser bloqueada para transações com cartão de crédito.
> * Para evitar timeouts e consequentes duplicidades na captura, recomendamos configurar um timeout mínimo de 60 segundos para esta requisição.

<br />

> 🚧 Atenção
>
> * É permitido a criação de parcelamentos no cartão de crédito em **até 21x para cartões de bandeira Visa e Master.**
>
> Anteriormente, era suportado parcelamentos de até 12 parcelas para todas as bandeiras.\
> **Para outras bandeiras, exceto Visa e Master, o limite continua sendo de 12 parcelas.**

# Crie cobrança de cartão de crédito com pré-autorização

A Pré-Autorização funciona como uma reserva de saldo no cartão do cliente, garantindo que o valor esperado estará disponível.

Ao invés de debitar efetivamente o valor, é feita uma reserva, fazendo com que esse valor seja subtraído do limite do cartão até que a captura, seja feita ou a Pré-Autorização expire.

A diferença entre criar uma cobrança Pré-Autorizada e uma cobrança de captura imediata está apenas no atributo `authorizeOnly`, que deverá ser enviado com o valor `true`, indicando que somente a Pré-Autorização será realizada para este faturamento.

> 📘
>
> * Uma cobrança Pré-Autorizada será revertida automaticamente após 3 dias caso não seja capturada.\* Para cancelar a Pré-Autorização antes dos 3 dias, você deverá utilizar o recurso [Estorno de pagamento](https://docs.asaas.com/reference/estornar-cobranca).\* A cobrança pré-autorizada será criada com o status `AUTHORIZED` após a criação bem-sucedida.\* No Sandbox, as capturas são aprovadas automaticamente. Para simular um erro, basta utilizar uma cobrança que não foi criada em Pré-Autorização ou com status diferente de Autorizado.

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
      "name": "Cobranças"
    }
  ],
  "paths": {
    "/v3/payments/": {
      "post": {
        "tags": [
          "Cobranças"
        ],
        "summary": "Criar cobrança com cartão de crédito",
        "description": "",
        "operationId": "criar-cobranca-com-cartao-de-credito",
        "parameters": [],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "customer",
                  "billingType",
                  "value",
                  "dueDate",
                  "remoteIp"
                ],
                "type": "object",
                "properties": {
                  "customer": {
                    "type": "string",
                    "description": "Identificador único do cliente no Asaas",
                    "nullable": false,
                    "example": "cus_G7Dvo4iphUNk",
                    "deprecated": false
                  },
                  "billingType": {
                    "type": "string",
                    "description": "Forma de pagamento",
                    "nullable": false,
                    "example": "BOLETO",
                    "deprecated": false,
                    "enum": [
                      "UNDEFINED",
                      "BOLETO",
                      "CREDIT_CARD",
                      "PIX"
                    ],
                    "x-readme-ref-name": "PaymentSaveWithCreditCardRequestBillingType"
                  },
                  "value": {
                    "type": "number",
                    "description": "Valor da cobrança",
                    "nullable": false,
                    "example": 129.9,
                    "deprecated": false
                  },
                  "dueDate": {
                    "type": "string",
                    "description": "Data de vencimento da cobrança",
                    "format": "date",
                    "nullable": false,
                    "example": "2017-06-10",
                    "deprecated": false
                  },
                  "description": {
                    "type": "string",
                    "description": "Descrição da cobrança (máx. 500 caracteres)",
                    "example": "Pedido 056984",
                    "deprecated": false
                  },
                  "daysAfterDueDateToRegistrationCancellation": {
                    "type": "integer",
                    "description": "Dias após o vencimento para cancelamento do registro (somente para boleto bancário)",
                    "format": "int32",
                    "example": 1,
                    "deprecated": false
                  },
                  "externalReference": {
                    "type": "string",
                    "description": "Campo livre para busca",
                    "example": "056984",
                    "deprecated": false
                  },
                  "installmentCount": {
                    "type": "integer",
                    "description": "Número de parcelas (somente no caso de cobrança parcelada)",
                    "format": "int32",
                    "deprecated": false,
                    "example": null
                  },
                  "totalValue": {
                    "type": "number",
                    "description": "Informe o valor total de uma cobrança que será parcelada (somente no caso de cobrança parcelada). Caso enviado este campo o installmentValue não é necessário, o cálculo por parcela será automático.",
                    "deprecated": false,
                    "example": null
                  },
                  "installmentValue": {
                    "type": "number",
                    "description": "Valor de cada parcela (somente no caso de cobrança parcelada). Envie este campo em caso de querer definir o valor de cada parcela.",
                    "deprecated": false,
                    "example": null
                  },
                  "discount": {
                    "type": "object",
                    "properties": {
                      "value": {
                        "type": "number",
                        "description": "Valor percentual ou fixo de desconto a ser aplicado sobre o valor da cobrança",
                        "example": 10,
                        "deprecated": false
                      },
                      "dueDateLimitDays": {
                        "type": "integer",
                        "description": "Dias antes do vencimento para aplicar desconto. Ex: 0 = até o vencimento, 1 = até um dia antes, 2 = até dois dias antes, e assim por diante",
                        "format": "int32",
                        "example": 0,
                        "deprecated": false
                      },
                      "type": {
                        "type": "string",
                        "description": "Tipo de desconto",
                        "example": "PERCENTAGE",
                        "deprecated": false,
                        "enum": [
                          "FIXED",
                          "PERCENTAGE"
                        ],
                        "x-readme-ref-name": "PaymentDiscountDiscountType"
                      }
                    },
                    "description": "Informações de desconto",
                    "deprecated": false,
                    "x-readme-ref-name": "PaymentDiscountDTO"
                  },
                  "interest": {
                    "type": "object",
                    "properties": {
                      "value": {
                        "type": "number",
                        "description": "Percentual de juros *ao mês* sobre o valor da cobrança para pagamento após o vencimento",
                        "deprecated": false,
                        "example": null
                      }
                    },
                    "description": "Informações de juros para pagamento após o vencimento",
                    "deprecated": false,
                    "x-readme-ref-name": "PaymentInterestRequestDTO"
                  },
                  "fine": {
                    "type": "object",
                    "properties": {
                      "value": {
                        "type": "number",
                        "description": "Percentual de multa sobre o valor da cobrança para pagamento após o vencimento",
                        "deprecated": false,
                        "example": null
                      },
                      "type": {
                        "type": "string",
                        "description": "Tipo de multa",
                        "example": "FIXED",
                        "deprecated": false,
                        "enum": [
                          "FIXED",
                          "PERCENTAGE"
                        ],
                        "x-readme-ref-name": "PaymentFineRequestFineType"
                      }
                    },
                    "description": "Informações de multa para pagamento após o vencimento",
                    "deprecated": false,
                    "x-readme-ref-name": "PaymentFineRequestDTO"
                  },
                  "postalService": {
                    "type": "boolean",
                    "description": "Define se a cobrança será enviada via Correios",
                    "example": false,
                    "deprecated": false
                  },
                  "split": {
                    "type": "array",
                    "description": "Configurações do split",
                    "deprecated": false,
                    "items": {
                      "required": [
                        "walletId"
                      ],
                      "type": "object",
                      "properties": {
                        "walletId": {
                          "type": "string",
                          "description": "Identificador da carteira Asaas que será transferido",
                          "nullable": false,
                          "deprecated": false,
                          "example": null
                        },
                        "fixedValue": {
                          "type": "number",
                          "description": "Valor fixo a ser transferido para a conta quando a cobrança for recebida",
                          "deprecated": false,
                          "example": null
                        },
                        "percentualValue": {
                          "type": "number",
                          "description": "Percentual sobre o valor líquido da cobrança a ser transferido quando for recebida",
                          "deprecated": false,
                          "example": null
                        },
                        "totalFixedValue": {
                          "type": "number",
                          "description": "(Somente parcelamentos). Valor que será feito split referente ao valor total que será parcelado.",
                          "deprecated": false,
                          "example": null
                        },
                        "externalReference": {
                          "type": "string",
                          "description": "Identificador do split no seu sistema",
                          "deprecated": false,
                          "example": null
                        },
                        "description": {
                          "type": "string",
                          "description": "Descrição do split",
                          "deprecated": false,
                          "example": null
                        }
                      },
                      "description": "Configurações do split",
                      "deprecated": false,
                      "x-readme-ref-name": "PaymentSplitRequestDTO"
                    }
                  },
                  "callback": {
                    "required": [
                      "successUrl"
                    ],
                    "type": "object",
                    "properties": {
                      "successUrl": {
                        "maxLength": 255,
                        "type": "string",
                        "description": "URL que o cliente será redirecionado após o pagamento com sucesso da fatura ou link de pagamento",
                        "nullable": false,
                        "deprecated": false,
                        "example": null
                      },
                      "autoRedirect": {
                        "type": "boolean",
                        "description": "Definir se o cliente será redirecionado automaticamente ou será apenas informado com um botão para retornar ao site. O padrão é true, caso queira desativar informar false",
                        "deprecated": false,
                        "example": null
                      }
                    },
                    "description": "Informações de redirecionamento automático após pagamento do link de pagamento",
                    "deprecated": false,
                    "x-readme-ref-name": "PaymentCallbackRequestDTO"
                  },
                  "creditCard": {
                    "required": [
                      "holderName",
                      "number",
                      "expiryMonth",
                      "expiryYear",
                      "ccv"
                    ],
                    "type": "object",
                    "properties": {
                      "holderName": {
                        "type": "string",
                        "description": "Nome impresso no cartão",
                        "nullable": false,
                        "example": "John Doe",
                        "deprecated": false
                      },
                      "number": {
                        "type": "string",
                        "description": "Número do cartão",
                        "nullable": false,
                        "example": "1234567890123456",
                        "deprecated": false
                      },
                      "expiryMonth": {
                        "type": "string",
                        "description": "Mês de expiração com 2 dígitos",
                        "nullable": false,
                        "example": "1",
                        "deprecated": false
                      },
                      "expiryYear": {
                        "type": "string",
                        "description": "Ano de expiração com 4 dígitos",
                        "nullable": false,
                        "example": "2026",
                        "deprecated": false
                      },
                      "ccv": {
                        "type": "string",
                        "description": "Código de segurança",
                        "nullable": false,
                        "example": "123",
                        "deprecated": false
                      }
                    },
                    "description": "Informações do cartão de crédito",
                    "nullable": false,
                    "deprecated": false,
                    "x-readme-ref-name": "CreditCardRequestDTO"
                  },
                  "creditCardHolderInfo": {
                    "required": [
                      "name",
                      "email",
                      "cpfCnpj",
                      "postalCode",
                      "addressNumber",
                      "phone"
                    ],
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string",
                        "description": "Nome do titular do cartão",
                        "nullable": false,
                        "example": "John Doe",
                        "deprecated": false
                      },
                      "email": {
                        "type": "string",
                        "description": "Email do titular do cartão",
                        "nullable": false,
                        "example": "john.doe@asaas.com",
                        "deprecated": false
                      },
                      "cpfCnpj": {
                        "type": "string",
                        "description": "CPF ou CNPJ do titular do cartão",
                        "nullable": false,
                        "example": "12345678901",
                        "deprecated": false
                      },
                      "postalCode": {
                        "type": "string",
                        "description": "CEP do titular do cartão",
                        "nullable": false,
                        "example": "12345678",
                        "deprecated": false
                      },
                      "addressNumber": {
                        "type": "string",
                        "description": "Número do endereço do titular do cartão",
                        "nullable": false,
                        "example": "123",
                        "deprecated": false
                      },
                      "addressComplement": {
                        "type": "string",
                        "description": "Complemento do endereço do titular do cartão",
                        "deprecated": false,
                        "example": null
                      },
                      "phone": {
                        "type": "string",
                        "description": "Telefone com DDD do titular do cartão",
                        "nullable": false,
                        "deprecated": false,
                        "example": null
                      },
                      "mobilePhone": {
                        "type": "string",
                        "description": "Celular do titular do cartão",
                        "deprecated": false,
                        "example": null
                      }
                    },
                    "description": "Informações do titular do cartão de crédito",
                    "nullable": false,
                    "deprecated": false,
                    "x-readme-ref-name": "CreditCardHolderInfoRequestDTO"
                  },
                  "creditCardToken": {
                    "type": "string",
                    "description": "Token do cartão de crédito para uso da funcionalidade de tokenização de cartão de crédito",
                    "deprecated": false,
                    "example": null
                  },
                  "authorizeOnly": {
                    "type": "boolean",
                    "description": "Realizar apenas a Pré-Autorização da cobrança",
                    "deprecated": false,
                    "example": null
                  },
                  "remoteIp": {
                    "type": "string",
                    "description": "IP de onde o cliente está fazendo a compra. Não deve ser informado o IP do seu servidor.",
                    "nullable": false,
                    "deprecated": false,
                    "example": null
                  }
                },
                "x-readme-ref-name": "PaymentSaveWithCreditCardRequestDTO"
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
                      "description": "Tipo do objeto",
                      "example": "payment",
                      "deprecated": false
                    },
                    "id": {
                      "type": "string",
                      "description": "Identificador único da cobrança no Asaas",
                      "example": "pay_080225913252",
                      "deprecated": false
                    },
                    "dateCreated": {
                      "type": "string",
                      "description": "Data de criação da cobrança",
                      "format": "date",
                      "example": "2017-03-10",
                      "deprecated": false
                    },
                    "customer": {
                      "type": "string",
                      "description": "Identificador único do cliente ao qual a cobrança pertence",
                      "example": "cus_G7Dvo4iphUNk",
                      "deprecated": false
                    },
                    "subscription": {
                      "type": "string",
                      "description": "Identificador único da assinatura (quando cobrança recorrente)",
                      "deprecated": false,
                      "example": null
                    },
                    "installment": {
                      "type": "string",
                      "description": "Identificador único do parcelamento (quando cobrança parcelada)",
                      "deprecated": false,
                      "example": null
                    },
                    "checkoutSession": {
                      "type": "string",
                      "description": "Identificador único do checkout",
                      "example": "356eb0c4-9eb7-4b7f-b2be-d9479af1d29f",
                      "deprecated": false
                    },
                    "paymentLink": {
                      "type": "string",
                      "description": "Identificador único do link de pagamentos ao qual a cobrança pertence",
                      "deprecated": false,
                      "example": null
                    },
                    "value": {
                      "type": "number",
                      "description": "Valor da cobrança",
                      "example": 129.9,
                      "deprecated": false
                    },
                    "netValue": {
                      "type": "number",
                      "description": "Valor líquido da cobrança após desconto da tarifa do Asaas",
                      "example": 124.9,
                      "deprecated": false
                    },
                    "originalValue": {
                      "type": "number",
                      "description": "Valor original da cobrança (preenchido quando paga com juros e multa)",
                      "deprecated": false,
                      "example": null
                    },
                    "interestValue": {
                      "type": "number",
                      "description": "Valor calculado de juros e multa que deve ser pago após o vencimento da cobrança",
                      "deprecated": false,
                      "example": null
                    },
                    "description": {
                      "type": "string",
                      "description": "Descrição da cobrança",
                      "example": "Pedido 056984",
                      "deprecated": false
                    },
                    "billingType": {
                      "type": "string",
                      "description": "Forma de pagamento",
                      "example": "BOLETO",
                      "deprecated": false,
                      "enum": [
                        "UNDEFINED",
                        "BOLETO",
                        "CREDIT_CARD",
                        "DEBIT_CARD",
                        "TRANSFER",
                        "DEPOSIT",
                        "PIX"
                      ],
                      "x-readme-ref-name": "PaymentGetResponseBillingType"
                    },
                    "creditCard": {
                      "type": "object",
                      "properties": {
                        "creditCardNumber": {
                          "type": "string",
                          "description": "Últimos 4 dígitos do cartão utilizado",
                          "example": "8829",
                          "deprecated": false
                        },
                        "creditCardBrand": {
                          "type": "string",
                          "description": "Bandeira do cartão utilizado",
                          "example": "VISA",
                          "deprecated": false,
                          "enum": [
                            "VISA",
                            "MASTERCARD",
                            "ELO",
                            "DINERS",
                            "DISCOVER",
                            "AMEX",
                            "CABAL",
                            "BANESCARD",
                            "CREDZ",
                            "SOROCRED",
                            "CREDSYSTEM",
                            "JCB",
                            "UNKNOWN"
                          ],
                          "x-readme-ref-name": "PaymentSaveWithCreditCardCreditCardCreditCardBrand"
                        },
                        "creditCardToken": {
                          "type": "string",
                          "description": "Token do cartão de crédito caso a tokenização esteja ativa.",
                          "deprecated": false,
                          "example": null
                        }
                      },
                      "description": "Informações do cartão de crédito",
                      "deprecated": false,
                      "x-readme-ref-name": "PaymentSaveWithCreditCardCreditCardDTO"
                    },
                    "canBePaidAfterDueDate": {
                      "type": "boolean",
                      "description": "Informa se a cobrança pode ser paga após o vencimento (Somente para boleto)",
                      "example": true,
                      "deprecated": false
                    },
                    "pixTransaction": {
                      "type": "string",
                      "description": "Identificador único da transação Pix à qual a cobrança pertence",
                      "deprecated": false,
                      "example": null
                    },
                    "pixQrCodeId": {
                      "type": "string",
                      "description": "Identificador único do QrCode estático gerado para determinada chave Pix",
                      "deprecated": false,
                      "example": null
                    },
                    "status": {
                      "type": "string",
                      "description": "Status da cobrança",
                      "example": "PENDING",
                      "deprecated": false,
                      "enum": [
                        "PENDING",
                        "RECEIVED",
                        "CONFIRMED",
                        "OVERDUE",
                        "REFUNDED",
                        "RECEIVED_IN_CASH",
                        "REFUND_REQUESTED",
                        "REFUND_IN_PROGRESS",
                        "CHARGEBACK_REQUESTED",
                        "CHARGEBACK_DISPUTE",
                        "AWAITING_CHARGEBACK_REVERSAL",
                        "DUNNING_REQUESTED",
                        "DUNNING_RECEIVED",
                        "AWAITING_RISK_ANALYSIS"
                      ],
                      "x-readme-ref-name": "PaymentGetResponsePaymentStatus"
                    },
                    "dueDate": {
                      "type": "string",
                      "description": "Data de vencimento da cobrança",
                      "format": "date",
                      "example": "2017-06-10",
                      "deprecated": false
                    },
                    "originalDueDate": {
                      "type": "string",
                      "description": "Vencimento original no ato da criação da cobrança",
                      "format": "date",
                      "example": "2017-06-10",
                      "deprecated": false
                    },
                    "paymentDate": {
                      "type": "string",
                      "description": "Data de liquidação da cobrança no Asaas",
                      "format": "date",
                      "deprecated": false,
                      "example": null
                    },
                    "clientPaymentDate": {
                      "type": "string",
                      "description": "Data em que o cliente efetuou o pagamento do boleto",
                      "format": "date",
                      "deprecated": false,
                      "example": null
                    },
                    "installmentNumber": {
                      "type": "integer",
                      "description": "Número da parcela",
                      "format": "int32",
                      "deprecated": false,
                      "example": null
                    },
                    "invoiceUrl": {
                      "type": "string",
                      "description": "URL da fatura",
                      "example": "https://www.asaas.com/i/080225913252",
                      "deprecated": false
                    },
                    "invoiceNumber": {
                      "type": "string",
                      "description": "Número da fatura",
                      "example": "00005101",
                      "deprecated": false
                    },
                    "externalReference": {
                      "type": "string",
                      "description": "Campo livre para busca",
                      "example": "056984",
                      "deprecated": false
                    },
                    "deleted": {
                      "type": "boolean",
                      "description": "Determina se a cobrança foi removida",
                      "example": false,
                      "deprecated": false
                    },
                    "anticipated": {
                      "type": "boolean",
                      "description": "Define se a cobrança foi antecipada ou está em processo de antecipação",
                      "example": false,
                      "deprecated": false
                    },
                    "anticipable": {
                      "type": "boolean",
                      "description": "Determina se a cobrança é antecipável",
                      "example": false,
                      "deprecated": false
                    },
                    "creditDate": {
                      "type": "string",
                      "description": "Indica a data que o crédito ficou disponível",
                      "format": "date",
                      "example": "2017-06-10",
                      "deprecated": false
                    },
                    "estimatedCreditDate": {
                      "type": "string",
                      "description": "Data estimada de quando o crédito ficará disponível",
                      "format": "date",
                      "example": "2017-06-10",
                      "deprecated": false
                    },
                    "transactionReceiptUrl": {
                      "type": "string",
                      "description": "URL do comprovante de confirmação, recebimento, estorno ou remoção.",
                      "deprecated": false,
                      "example": null
                    },
                    "nossoNumero": {
                      "type": "string",
                      "description": "Identificação única do boleto",
                      "example": "6453",
                      "deprecated": false
                    },
                    "bankSlipUrl": {
                      "type": "string",
                      "description": "URL para download do boleto",
                      "example": "https://www.asaas.com/b/pdf/080225913252",
                      "deprecated": false
                    },
                    "discount": {
                      "type": "object",
                      "properties": {
                        "value": {
                          "type": "number",
                          "description": "Valor percentual ou fixo de desconto a ser aplicado sobre o valor da cobrança",
                          "example": 10,
                          "deprecated": false
                        },
                        "dueDateLimitDays": {
                          "type": "integer",
                          "description": "Dias antes do vencimento para aplicar desconto. Ex: 0 = até o vencimento, 1 = até um dia antes, 2 = até dois dias antes, e assim por diante",
                          "format": "int32",
                          "example": 0,
                          "deprecated": false
                        },
                        "type": {
                          "type": "string",
                          "description": "Tipo de desconto",
                          "example": "PERCENTAGE",
                          "deprecated": false,
                          "enum": [
                            "FIXED",
                            "PERCENTAGE"
                          ],
                          "x-readme-ref-name": "PaymentDiscountDiscountType"
                        }
                      },
                      "description": "Informações de desconto",
                      "deprecated": false,
                      "x-readme-ref-name": "PaymentDiscountDTO"
                    },
                    "fine": {
                      "type": "object",
                      "properties": {
                        "value": {
                          "type": "number",
                          "description": "Valor da multa em porcentagem",
                          "example": 1,
                          "deprecated": false
                        }
                      },
                      "description": "Informações de multa para pagamento após o vencimento",
                      "deprecated": false,
                      "x-readme-ref-name": "PaymentFineResponseDTO"
                    },
                    "interest": {
                      "type": "object",
                      "properties": {
                        "value": {
                          "type": "number",
                          "description": "Valor dos juros em porcentagem",
                          "example": 2,
                          "deprecated": false
                        }
                      },
                      "description": "Informações de juros para pagamento após o vencimento",
                      "deprecated": false,
                      "x-readme-ref-name": "PaymentInterestResponseDTO"
                    },
                    "split": {
                      "type": "array",
                      "description": "Configurações do split",
                      "deprecated": false,
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string",
                            "description": "Identificador único do split pago no Asaas",
                            "example": "fd41396a-7453-47d0-9411-c8543522591d",
                            "deprecated": false
                          },
                          "walletId": {
                            "type": "string",
                            "description": "Identificador da carteira Asaas que será transferido",
                            "example": "7bafd95a-e783-4a62-9be1-23999af742c6",
                            "deprecated": false
                          },
                          "fixedValue": {
                            "type": "number",
                            "description": "Valor fixo a ser transferido para a conta quando a cobrança for recebida",
                            "example": 20.32,
                            "deprecated": false
                          },
                          "percentualValue": {
                            "type": "number",
                            "description": "Percentual sobre o valor líquido da cobrança a ser transferido quando for recebida",
                            "deprecated": false,
                            "example": null
                          },
                          "totalValue": {
                            "type": "number",
                            "description": "Valor total do split que será enviado. Os valores exibidos podem sofrer alteração após a confirmação ou alteração da cobrança.",
                            "example": 20.32,
                            "deprecated": false
                          },
                          "cancellationReason": {
                            "type": "string",
                            "description": "Motivo de cancelamento do split",
                            "example": "PAYMENT_DELETED",
                            "deprecated": false,
                            "enum": [
                              "PAYMENT_DELETED",
                              "PAYMENT_OVERDUE",
                              "PAYMENT_RECEIVED_IN_CASH",
                              "PAYMENT_REFUNDED",
                              "VALUE_DIVERGENCE_BLOCK",
                              "WALLET_UNABLE_TO_RECEIVE"
                            ],
                            "x-readme-ref-name": "PaymentSplitGetResponsePaymentSplitCancellationReason"
                          },
                          "status": {
                            "type": "string",
                            "description": "Status do split",
                            "example": "PENDING",
                            "deprecated": false,
                            "enum": [
                              "PENDING",
                              "PROCESSING",
                              "PROCESSING_REFUND",
                              "AWAITING_CREDIT",
                              "CANCELLED",
                              "DONE",
                              "REFUNDED",
                              "BLOCKED_BY_VALUE_DIVERGENCE"
                            ],
                            "x-readme-ref-name": "PaymentSplitGetResponsePaymentSplitStatus"
                          },
                          "externalReference": {
                            "type": "string",
                            "description": "Identificador do split no seu sistema",
                            "deprecated": false,
                            "example": null
                          },
                          "description": {
                            "type": "string",
                            "description": "Descrição do split",
                            "deprecated": false,
                            "example": null
                          }
                        },
                        "description": "Configurações do split",
                        "deprecated": false,
                        "x-readme-ref-name": "PaymentSplitGetResponseDTO"
                      }
                    },
                    "postalService": {
                      "type": "boolean",
                      "description": "Define se a cobrança será enviada via Correios",
                      "example": false,
                      "deprecated": false
                    },
                    "daysAfterDueDateToRegistrationCancellation": {
                      "type": "integer",
                      "description": "Dias após o vencimento para cancelamento do registro (somente para boleto bancário)",
                      "format": "int32",
                      "deprecated": false,
                      "example": null
                    },
                    "chargeback": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "description": "Identificador único do chargeback.",
                          "example": "8e784c3e-afe8-4844-bb93-6b445763",
                          "deprecated": false
                        },
                        "payment": {
                          "type": "string",
                          "description": "Identificador único da cobrança no Asaas",
                          "example": "pay_pBtDdshgBD2Rt",
                          "deprecated": false
                        },
                        "installment": {
                          "type": "string",
                          "description": "Identificador único do parcelamento no Asaas",
                          "example": "b8dd74c-d078-40a0-9ae1-61a66c61a204",
                          "deprecated": false
                        },
                        "customerAccount": {
                          "type": "string",
                          "description": "Identificador único do cliente ao qual o chargeback está vinculado.",
                          "example": "cus_000000004085",
                          "deprecated": false
                        },
                        "status": {
                          "type": "string",
                          "description": "Status do chargeback",
                          "example": "DONE",
                          "deprecated": false,
                          "enum": [
                            "REQUESTED",
                            "IN_DISPUTE",
                            "DISPUTE_LOST",
                            "REVERSED",
                            "DONE"
                          ],
                          "x-readme-ref-name": "PaymentChargebackResponseChargebackStatus"
                        },
                        "reason": {
                          "type": "string",
                          "description": "Razão do chargeback",
                          "example": "COMMERCIAL_DISAGREEMENT",
                          "deprecated": false,
                          "enum": [
                            "ABSENCE_OF_PRINT",
                            "ABSENT_CARD_FRAUD",
                            "CARD_ACTIVATED_PHONE_TRANSACTION",
                            "CARD_FRAUD",
                            "CARD_RECOVERY_BULLETIN",
                            "COMMERCIAL_DISAGREEMENT",
                            "COPY_NOT_RECEIVED",
                            "CREDIT_OR_DEBIT_PRESENTATION_ERROR",
                            "DIFFERENT_PAY_METHOD",
                            "FRAUD",
                            "INCORRECT_TRANSACTION_VALUE",
                            "INVALID_CURRENCY",
                            "INVALID_DATA",
                            "LATE_PRESENTATION",
                            "LOCAL_REGULATORY_OR_LEGAL_DISPUTE",
                            "MULTIPLE_ROCS",
                            "ORIGINAL_CREDIT_TRANSACTION_NOT_ACCEPTED",
                            "OTHER_ABSENT_CARD_FRAUD",
                            "PROCESS_ERROR",
                            "RECEIVED_COPY_ILLEGIBLE_OR_INCOMPLETE",
                            "RECURRENCE_CANCELED",
                            "REQUIRED_AUTHORIZATION_NOT_GRANTED",
                            "RIGHT_OF_FULL_RECOURSE_FOR_FRAUD",
                            "SALE_CANCELED",
                            "SERVICE_DISAGREEMENT_OR_DEFECTIVE_PRODUCT",
                            "SERVICE_NOT_RECEIVED",
                            "SPLIT_SALE",
                            "TRANSFERS_OF_DIVERSE_RESPONSIBILITIES",
                            "UNQUALIFIED_CAR_RENTAL_DEBIT",
                            "USA_CARDHOLDER_DISPUTE",
                            "VISA_FRAUD_MONITORING_PROGRAM",
                            "WARNING_BULLETIN_FILE"
                          ],
                          "x-readme-ref-name": "PaymentChargebackResponseChargebackReason"
                        },
                        "disputeStartDate": {
                          "type": "string",
                          "description": "Data de abertura do chargeback.",
                          "format": "date",
                          "example": "2024-11-10",
                          "deprecated": false
                        },
                        "value": {
                          "type": "number",
                          "description": "Valor do chargeback.",
                          "example": 2323.45,
                          "deprecated": false
                        },
                        "paymentDate": {
                          "type": "string",
                          "description": "Data de liquidação da cobrança no Asaas",
                          "format": "date",
                          "example": "2024-03-10",
                          "deprecated": false
                        },
                        "creditCard": {
                          "type": "object",
                          "properties": {
                            "number": {
                              "type": "string",
                              "description": "Últimos 4 dígitos do cartão utilizado",
                              "example": "8829",
                              "deprecated": false
                            },
                            "brand": {
                              "type": "string",
                              "description": "Bandeira do cartão utilizado",
                              "example": "VISA",
                              "deprecated": false,
                              "enum": [
                                "VISA",
                                "MASTERCARD",
                                "ELO",
                                "DINERS",
                                "DISCOVER",
                                "AMEX",
                                "CABAL",
                                "BANESCARD",
                                "CREDZ",
                                "SOROCRED",
                                "CREDSYSTEM",
                                "JCB",
                                "UNKNOWN"
                              ],
                              "x-readme-ref-name": "ChargebackCreditCardResponseCreditCardBrand"
                            }
                          },
                          "description": "Informações do cartão de crédito",
                          "deprecated": false,
                          "x-readme-ref-name": "ChargebackCreditCardResponseDTO"
                        },
                        "disputeStatus": {
                          "type": "string",
                          "description": "Status da disputa do chargeback.",
                          "example": "ACCEPTED",
                          "deprecated": false,
                          "enum": [
                            "REQUESTED",
                            "ACCEPTED",
                            "REJECTED"
                          ],
                          "x-readme-ref-name": "PaymentChargebackResponseChargebackDisputeStatus"
                        },
                        "deadlineToSendDisputeDocuments": {
                          "type": "string",
                          "description": "Data limite para envio de documentos de disputa.",
                          "format": "date",
                          "example": "2024-12-10",
                          "deprecated": false
                        }
                      },
                      "x-readme-ref-name": "PaymentChargebackResponseDTO"
                    },
                    "escrow": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "description": "Identificador único da garantia da cobrança na Conta Escrow do Asaas",
                          "example": "4f468235-cec3-482f-b3d0-348af4c7194",
                          "deprecated": false
                        },
                        "status": {
                          "type": "string",
                          "description": "Status da garantia da cobrança",
                          "example": "ACTIVE",
                          "deprecated": false,
                          "enum": [
                            "ACTIVE",
                            "DONE"
                          ],
                          "x-readme-ref-name": "PaymentEscrowGetResponsePaymentEscrowStatus"
                        },
                        "expirationDate": {
                          "type": "string",
                          "description": "Data de expiração da garantia da cobrança",
                          "format": "date",
                          "example": "2024-06-10",
                          "deprecated": false
                        },
                        "finishDate": {
                          "type": "string",
                          "description": "Data de encerramento da garantia da cobrança",
                          "format": "date",
                          "example": "2024-06-10",
                          "deprecated": false
                        },
                        "finishReason": {
                          "type": "string",
                          "description": "Motivo do encerramento da garantia da cobrança",
                          "example": "EXPIRED",
                          "deprecated": false,
                          "enum": [
                            "CHARGEBACK",
                            "EXPIRED",
                            "INSUFFICIENT_BALANCE",
                            "PAYMENT_REFUNDED",
                            "REQUESTED_BY_CUSTOMER",
                            "CUSTOMER_CONFIG_DISABLED"
                          ],
                          "x-readme-ref-name": "PaymentEscrowGetResponsePaymentEscrowFinishReason"
                        }
                      },
                      "description": "Informações de garantia da cobrança na Conta Escrow",
                      "deprecated": false,
                      "x-readme-ref-name": "PaymentEscrowGetResponseDTO"
                    },
                    "refunds": {
                      "type": "array",
                      "description": "Informações de estorno",
                      "deprecated": false,
                      "items": {
                        "type": "object",
                        "properties": {
                          "dateCreated": {
                            "type": "string",
                            "description": "Data da criação do estorno",
                            "format": "date-time",
                            "example": "2024-10-18 10:19:06",
                            "deprecated": false
                          },
                          "status": {
                            "type": "string",
                            "description": "Status do estorno",
                            "example": "DONE",
                            "deprecated": false,
                            "enum": [
                              "PENDING",
                              "AWAITING_CRITICAL_ACTION_AUTHORIZATION",
                              "AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION",
                              "CANCELLED",
                              "DONE"
                            ],
                            "x-readme-ref-name": "PaymentRefundGetResponsePaymentRefundStatus"
                          },
                          "value": {
                            "type": "number",
                            "description": "Valor do estorno",
                            "example": 40,
                            "deprecated": false
                          },
                          "endToEndIdentifier": {
                            "type": "string",
                            "description": "(Apenas pix) Identificador da transação Pix no Banco Central",
                            "deprecated": false,
                            "example": null
                          },
                          "description": {
                            "type": "string",
                            "description": "Descrição do estorno",
                            "deprecated": false,
                            "example": null
                          },
                          "effectiveDate": {
                            "type": "string",
                            "description": "(Apenas pix) Data de efetivação do estorno",
                            "format": "date-time",
                            "example": "2024-10-19 10:19:06",
                            "deprecated": false
                          },
                          "transactionReceiptUrl": {
                            "type": "string",
                            "description": "Link do recibo da transação",
                            "deprecated": false,
                            "example": null
                          },
                          "refundedSplits": {
                            "type": "array",
                            "description": "Lista de splits estornados, se houver",
                            "deprecated": false,
                            "items": {
                              "type": "object",
                              "properties": {
                                "id": {
                                  "type": "string",
                                  "description": "Identificador único do split",
                                  "example": "cff860dd-148e-48ca-ac8e-849684175158",
                                  "deprecated": false
                                },
                                "value": {
                                  "type": "number",
                                  "description": "Valor estornado",
                                  "example": 10,
                                  "deprecated": false
                                },
                                "done": {
                                  "type": "boolean",
                                  "description": "Indica se o split foi estornado",
                                  "example": true,
                                  "deprecated": false
                                }
                              },
                              "description": "Lista de splits estornados, se houver",
                              "deprecated": false,
                              "x-readme-ref-name": "PaymentRefundedSplitResponseDTO"
                            }
                          }
                        },
                        "description": "Informações de estorno",
                        "deprecated": false,
                        "x-readme-ref-name": "PaymentRefundGetResponseDTO"
                      }
                    }
                  },
                  "x-readme-ref-name": "PaymentGetResponseDTO"
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
                      "code": "invalid_customer",
                      "description": "Customer Inválido ou não informado"
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