# Notificação Global Asaas

## Visão Geral

Centralizar as configurações de notificações de cobrança do Asaas em uma tela única na Alusa, acessível por `configurações/notificações/asaas`. Assim, todas as cobranças futuras seguirão o padrão definido, sem necessidade de configuração individual por cliente ou cobrança.

---

## Justificativa

- Reduz retrabalho e inconsistências.
- Garante que todas as cobranças sigam o mesmo padrão de comunicação.
- Facilita ajustes rápidos em massa.
- Compatível com a API oficial do Asaas, que permite configurações por cliente.

---

## Tipos de Eventos de Notificação (Asaas API)

| Evento (API)                | Descrição                                                                 |
|-----------------------------|---------------------------------------------------------------------------|
| `PAYMENT_CREATED`           | Cobrança criada (exceto assinaturas)                                      |
| `PAYMENT_UPDATED`           | Alteração no valor ou data de vencimento                                  |
| `PAYMENT_DUEDATE_WARNING`   | Aviso de vencimento (pode ter `scheduleOffset` para X dias antes)         |
| `SEND_LINHA_DIGITAVEL`      | Envio da linha digitável se o boleto não foi visualizado                  |
| `PAYMENT_OVERDUE`           | Cobrança vencida/atrasada (pode ter `scheduleOffset` para lembretes)      |
| `PAYMENT_RECEIVED`          | Pagamento confirmado                                                      |

---

## Canais de Notificação Suportados

### Para mim (Provider/Empresa)
| Canal   | Propriedade API                  |
|---------|----------------------------------|
| Email   | `emailEnabledForProvider`        |
| SMS     | `smsEnabledForProvider`          |

### Para meu cliente (Customer)
| Canal     | Propriedade API                    |
|-----------|------------------------------------|
| Email     | `emailEnabledForCustomer`          |
| SMS       | `smsEnabledForCustomer`            |
| WhatsApp  | `whatsappEnabledForCustomer`       |
| Ligação   | `phoneCallEnabledForCustomer`      |

---

## Agendamento de Notificações (scheduleOffset)

O campo `scheduleOffset` define quantos dias **antes** ou **depois** do evento a notificação será enviada:

| Evento                       | scheduleOffset | Comportamento                                      |
|------------------------------|----------------|----------------------------------------------------|
| `PAYMENT_DUEDATE_WARNING`    | `0`            | Envia no dia do vencimento                         |
| `PAYMENT_DUEDATE_WARNING`    | `10`           | Envia 10 dias antes do vencimento                  |
| `PAYMENT_OVERDUE`            | `0`            | Envia no dia que venceu                            |
| `PAYMENT_OVERDUE`            | `7`            | Relembra a cada 7 dias após vencimento (até 3x)    |

---

## Estrutura do Objeto de Notificação (API Asaas)

```json
{
  "object": "notification",
  "id": "not_f8JpoWuEjEKd",
  "customer": "cus_Y4AEif5zrMGK",
  "enabled": true,
  "emailEnabledForProvider": true,
  "smsEnabledForProvider": false,
  "emailEnabledForCustomer": true,
  "smsEnabledForCustomer": true,
  "phoneCallEnabledForCustomer": false,
  "whatsappEnabledForCustomer": false,
  "event": "PAYMENT_RECEIVED",
  "scheduleOffset": 0,
  "deleted": false
}
```

---

## Endpoints da API Asaas

### 1. Listar notificações de um cliente

```
GET /v3/customers/{id}/notifications
```

**Retorna:** Lista de todas as notificações configuradas para o cliente.

### 2. Atualizar uma notificação específica

```
POST /v3/notifications/{id}
```

**Body:**
```json
{
  "enabled": true,
  "emailEnabledForProvider": true,
  "smsEnabledForProvider": false,
  "emailEnabledForCustomer": true,
  "smsEnabledForCustomer": true,
  "phoneCallEnabledForCustomer": false,
  "whatsappEnabledForCustomer": false,
  "scheduleOffset": 10
}
```

### 3. Atualizar múltiplas notificações em lote

```
POST /v3/notifications/batch
```

**Body:**
```json
{
  "customer": "cus_Y4AEif5zrMGK",
  "notifications": [
    {
      "id": "not_f8JpoWuEjEKd",
      "enabled": true,
      "emailEnabledForProvider": true,
      "smsEnabledForProvider": false,
      "emailEnabledForCustomer": true,
      "smsEnabledForCustomer": true,
      "phoneCallEnabledForCustomer": false,
      "whatsappEnabledForCustomer": false
    }
  ]
}
```

---

## Plano de Implementação na Alusa

### Fase 1: Backend

1. **Model/Schema** - Criar tabela `ConfiguracaoNotificacaoAsaas` com:
   - `id`, `contaId`
   - Campos booleanos para cada canal/evento
   - Campo `scheduleOffset` para eventos com agendamento
   - `createdAt`, `updatedAt`

2. **Service** - Lógica para:
   - Salvar/atualizar configurações globais
   - Aplicar configurações ao criar/atualizar clientes no Asaas
   - Sincronizar com API do Asaas via batch

3. **API Routes**:
   - `GET /api/configuracoes/notificacoes-asaas` - Retorna config atual
   - `PUT /api/configuracoes/notificacoes-asaas` - Atualiza config

### Fase 2: Frontend

Criar tela em `configurações/notificações/asaas` com:

#### Seção: Notificações para cobranças antes do vencimento

| Evento                                      | Para mim (Email/SMS) | Para meu cliente (WhatsApp/Email/SMS) |
|---------------------------------------------|----------------------|---------------------------------------|
| Avisar criação de novas cobranças           | ☐ Email ☐ SMS        | ☐ WhatsApp ☐ Email ☐ SMS              |
| Avisar alteração no valor ou data           | ☐ Email ☐ SMS        | ☐ WhatsApp ☐ Email ☐ SMS              |
| Enviar cobranças **[X] dias** antes do vencimento | ☐ Email ☐ SMS  | ☐ WhatsApp ☐ Email ☐ SMS              |
| Enviar cobranças pendentes no dia do vencimento | ☐ Email ☐ SMS    | ☐ WhatsApp ☐ Email ☐ SMS              |
| Enviar linha digitável do boleto (se não visualizado) | ☐ Email ☐ SMS | ☐ WhatsApp ☐ Email ☐ SMS            |

#### Seção: Notificações para cobranças vencidas

| Evento                                      | Para mim (Email/SMS) | Para meu cliente (WhatsApp/Email/SMS/Ligação) |
|---------------------------------------------|----------------------|-----------------------------------------------|
| Avisar sobre atrasos e falhas nos pagamentos | ☐ Email ☐ SMS       | ☐ WhatsApp ☐ Email ☐ SMS ☐ Ligação            |
| Relembrar cobranças vencidas a cada **[X] dias** após o vencimento | ☐ Email ☐ SMS | ☐ WhatsApp ☐ Email ☐ SMS ☐ Ligação |

#### Seção: Notificação para cobranças pagas

| Evento                                      | Para mim (Email/SMS) | Para meu cliente (WhatsApp/Email/SMS) |
|---------------------------------------------|----------------------|---------------------------------------|
| Avisar quando os pagamentos forem confirmados | ☑ Email ☐ SMS       | ☐ WhatsApp ☑ Email ☑ SMS              |

### Fase 3: Integração

1. Ao cadastrar novo cliente na Alusa:
   - Criar customer no Asaas
   - Buscar notificações padrão: `GET /v3/customers/{id}/notifications`
   - Aplicar config global via batch: `POST /v3/notifications/batch`

2. Ao alterar configuração global:
   - Opcionalmente sincronizar clientes existentes (com confirmação do usuário)

### Fase 4: Testes

- **Unit**: Validação de schemas, transformação de dados
- **Integration**: Chamadas à API Asaas (mock)
- **E2E**: Fluxo completo de configuração + criação de cliente

---

## Observações Importantes

- **Notificações são fixas no Asaas**: Não é possível criar ou deletar eventos, apenas atualizar os existentes.
- **Configuração por cliente**: O Asaas gerencia notificações por cliente (`customer`), não globalmente.
- **Estratégia Alusa**: Salvar preferências globais no banco local e aplicar ao criar/atualizar clientes no Asaas.
- **Mudanças afetam apenas novos clientes** por padrão, mas pode-se oferecer opção de sincronizar existentes.

---

## Referências

- [Documentação Oficial Asaas - Notificações](https://docs.asaas.com/docs/alterando-notificacoes-de-um-cliente)
- [Documentação Oficial Asaas - Notificações Padrões](https://docs.asaas.com/docs/notificacoes-padroes)

