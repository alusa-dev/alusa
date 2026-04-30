# Módulo de Configurações de Notificações Asaas

Este módulo permite configurar as preferências de notificações globais para clientes no Asaas. As configurações são aplicadas automaticamente a novos clientes e podem ser sincronizadas para clientes já cadastrados.

---

## 📍 Localização

- **Rota da página**: `/admin/configuracoes/notificacoes/asaas`
- **API Endpoint**: `/api/configuracoes/notificacoes/asaas`
- **Permissões**: `ADMIN`, `FINANCEIRO`

---

## 🏗️ Arquitetura

### Estrutura de Arquivos

```
prisma/
  schema.prisma                          # Model AsaasNotificationPreference + enum AsaasNotificationEvent

packages/lib/src/services/integracoes/
  asaas-notifications.service.ts         # Service layer (backend)

apps/web/
  app/(app)/admin/configuracoes/notificacoes/asaas/
    page.tsx                             # Página Next.js

  app/api/configuracoes/notificacoes/asaas/
    route.ts                             # API Routes (GET, PUT)

  features/configuracoes/notificacoes/asaas/
    AsaasNotificationSettings.tsx        # Componente principal da UI
    constants.ts                         # Configuração de seções e canais
    types.ts                             # TypeScript types
    hooks/
      useAsaasNotificationSettings.ts    # Hook de estado e auto-save
```

---

## 📊 Modelo de Dados

### Enum: `AsaasNotificationEvent`

```prisma
enum AsaasNotificationEvent {
  PAYMENT_CREATED          // Cobrança criada
  PAYMENT_UPDATED          // Cobrança atualizada
  PAYMENT_DUEDATE_WARNING  // Aviso de vencimento
  SEND_LINHA_DIGITAVEL     // Linha digitável do boleto
  PAYMENT_OVERDUE          // Cobrança vencida
  PAYMENT_RECEIVED         // Pagamento recebido
}
```

### Model: `AsaasNotificationPreference`

```prisma
model AsaasNotificationPreference {
  id                          String                 @id @default(cuid())
  contaId                     String
  event                       AsaasNotificationEvent
  scheduleOffset              Int                    @default(0)
  enabled                     Boolean                @default(true)
  emailEnabledForProvider     Boolean                @default(false)
  smsEnabledForProvider       Boolean                @default(false)
  emailEnabledForCustomer     Boolean                @default(true)
  smsEnabledForCustomer       Boolean                @default(true)
  whatsappEnabledForCustomer  Boolean                @default(false)
  phoneCallEnabledForCustomer Boolean                @default(false)
  createdAt                   DateTime               @default(now())
  updatedAt                   DateTime               @updatedAt

  conta Conta @relation(fields: [contaId], references: [id], onDelete: Cascade)

  @@unique([contaId, event, scheduleOffset])
  @@index([contaId])
}
```

**Observação**: A constraint `@@unique([contaId, event, scheduleOffset])` permite múltiplas configurações por evento com diferentes offsets (ex: `PAYMENT_OVERDUE` com offset 0 e offset 7).

---

## 📨 Eventos de Notificação

### 1. Notificações Antes do Vencimento

| Evento | Descrição | scheduleOffset | Canais Disponíveis |
|--------|-----------|----------------|-------------------|
| `PAYMENT_CREATED` | Aviso de nova cobrança | 0 (fixo) | Email, SMS, WhatsApp (cliente) |
| `PAYMENT_UPDATED` | Alteração na cobrança | 0 (fixo) | Email, SMS, WhatsApp (cliente) |
| `PAYMENT_DUEDATE_WARNING` | Lembrete antes do vencimento | **5, 10, 15, 30 dias** | Email, SMS, WhatsApp (cliente) |
| `PAYMENT_DUEDATE_WARNING` | Aviso no dia do vencimento | 0 (fixo) | Email, SMS, WhatsApp (cliente) |
| `SEND_LINHA_DIGITAVEL` | Linha digitável do boleto | 0 (fixo) | Email, SMS (cliente) |

### 2. Notificações de Cobrança Vencida

| Evento | Descrição | scheduleOffset | Canais Disponíveis |
|--------|-----------|----------------|-------------------|
| `PAYMENT_OVERDUE` | Aviso de atraso | 0 (fixo) | Email, SMS, WhatsApp, Ligação (cliente) |
| `PAYMENT_OVERDUE` | Lembrete periódico de atraso | **1, 3, 7, 15, 30 dias** | Email, SMS, WhatsApp, Ligação (cliente) |

### 3. Notificações de Pagamento

| Evento | Descrição | scheduleOffset | Canais Disponíveis |
|--------|-----------|----------------|-------------------|
| `PAYMENT_RECEIVED` | Confirmação de pagamento | 0 (fixo) | Email, SMS, WhatsApp (cliente) |

---

## 🔌 API Endpoints

### GET `/api/configuracoes/notificacoes/asaas`

Retorna as preferências de notificação da conta autenticada.

**Response 200:**
```json
{
  "preferences": [
    {
      "id": "clxxx...",
      "contaId": "conta_123",
      "event": "PAYMENT_CREATED",
      "scheduleOffset": 0,
      "enabled": true,
      "emailEnabledForProvider": false,
      "smsEnabledForProvider": false,
      "emailEnabledForCustomer": true,
      "smsEnabledForCustomer": true,
      "whatsappEnabledForCustomer": false,
      "phoneCallEnabledForCustomer": false,
      "createdAt": "2025-12-03T00:00:00.000Z",
      "updatedAt": "2025-12-03T00:00:00.000Z"
    }
  ]
}
```

### PUT `/api/configuracoes/notificacoes/asaas`

Salva as preferências e opcionalmente sincroniza com clientes existentes.

**Request Body:**
```json
{
  "preferences": [
    {
      "event": "PAYMENT_DUEDATE_WARNING",
      "scheduleOffset": 10,
      "enabled": true,
      "emailEnabledForProvider": false,
      "smsEnabledForProvider": false,
      "emailEnabledForCustomer": true,
      "smsEnabledForCustomer": true,
      "whatsappEnabledForCustomer": true,
      "phoneCallEnabledForCustomer": false
    }
  ],
  "applyToExistingCustomers": true
}
```

**Response 200:**
```json
{
  "preferences": [...],
  "resync": {
    "processed": 150,
    "successes": 148,
    "failures": 2
  }
}
```

---

## 🔄 Fluxo de Sincronização com Asaas

### 1. Consulta de Notificações do Cliente

```
GET /v3/customers/{asaasCustomerId}/notifications
```

Retorna todas as notificações configuradas para o cliente no Asaas.

### 2. Atualização Individual

```
POST /v3/notifications/{notificationId}
```

**Payload:**
```json
{
  "enabled": true,
  "emailEnabledForProvider": false,
  "smsEnabledForProvider": false,
  "emailEnabledForCustomer": true,
  "smsEnabledForCustomer": true,
  "whatsappEnabledForCustomer": true,
  "phoneCallEnabledForCustomer": false,
  "scheduleOffset": 10
}
```

**⚠️ Importante**: O campo `scheduleOffset` só é aceito para os eventos:
- `PAYMENT_DUEDATE_WARNING`
- `PAYMENT_OVERDUE`

Para outros eventos, enviar `scheduleOffset` resulta em erro 400 "O número de dias informado é inválido".

### 3. Matching de Preferências

O sistema faz o matching entre preferências locais e notificações remotas usando a seguinte lógica:

```typescript
// Para eventos com offset configurável (PAYMENT_DUEDATE_WARNING, PAYMENT_OVERDUE):
if (pref.scheduleOffset > 0) {
  // Preferência local com offset > 0 → busca notificação remota com offset > 0
  targetRemote = remoteList.find(r => r.scheduleOffset > 0);
} else {
  // Preferência local com offset = 0 → busca notificação remota com offset = 0
  targetRemote = remoteList.find(r => r.scheduleOffset === 0);
}
```

Isso permite alterar o offset (ex: de 10 para 15 dias) e o sistema encontrará a notificação correta para atualizar.

---

## 🎨 Interface do Usuário

### Seções da Página

1. **Notificações para cobranças antes do vencimento**
   - Avisar criação de novas cobranças
   - Avisar alteração na cobrança
   - Enviar cobranças antes do vencimento (select: 5, 10, 15, 30 dias)
   - Enviar no dia do vencimento
   - Enviar linha digitável

2. **Notificações para cobranças vencidas**
   - Avisar sobre atrasos
   - Relembrar periodicamente (select: 1, 3, 7, 15, 30 dias)

3. **Notificações para cobranças pagas**
   - Avisar confirmação de pagamento

### Canais por Destinatário

| Destinatário | Canais Disponíveis |
|--------------|-------------------|
| **Para mim** (Provider) | Email, SMS |
| **Meu cliente** (Customer) | Email, SMS, WhatsApp, Ligação* |

*Ligação só disponível para eventos de atraso (`PAYMENT_OVERDUE`).

### Auto-Save

- As alterações são salvas automaticamente após 800ms de inatividade
- Log no console: `[Asaas Notifications] Preferências salvas automaticamente`
- Não há toast para auto-save (evita poluição visual)

### Sincronização Manual

- Botão "Sincronizar existentes" aplica as preferências a todos os clientes já cadastrados no Asaas
- Toast de sucesso/erro é exibido apenas para esta ação explícita

---

## ⚙️ Service Layer

### Funções Principais

```typescript
// Garante que a conta tenha preferências (cria defaults se não existir)
ensureAsaasNotificationPreferences(contaId: string): Promise<NotificationPreferenceDTO[]>

// Retorna as preferências da conta
getAsaasNotificationPreferences(contaId: string): Promise<NotificationPreferenceDTO[]>

// Salva/atualiza preferências (delete + recreate em transaction)
saveAsaasNotificationPreferences(
  contaId: string,
  preferences: NotificationPreferenceInput[]
): Promise<NotificationPreferenceDTO[]>

// Aplica preferências a um cliente específico no Asaas
applyAsaasNotificationPreferencesToCustomer(
  contaId: string,
  asaasCustomerId: string
): Promise<{ updated: boolean; total?: number }>

// Lista todos os asaasCustomerIds da conta (alunos + responsáveis)
listCustomerIdsWithAsaas(contaId: string): Promise<string[]>

// Aplica preferências a todos os clientes da conta
applyPreferencesToAllCustomers(contaId: string): Promise<{
  processed: number;
  successes: number;
  failures: number;
  errors: Array<{ customerId: string; message: string }>;
}>
```

---

## 🧪 Valores Padrão

Quando uma conta acessa pela primeira vez, são criadas 8 preferências com os seguintes defaults:

| Evento | Offset | Provider Email | Provider SMS | Customer Email | Customer SMS | WhatsApp | Ligação |
|--------|--------|----------------|--------------|----------------|--------------|----------|---------|
| PAYMENT_CREATED | 0 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| PAYMENT_UPDATED | 0 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| PAYMENT_DUEDATE_WARNING | 10 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| PAYMENT_DUEDATE_WARNING | 0 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| SEND_LINHA_DIGITAVEL | 0 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| PAYMENT_OVERDUE | 0 | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| PAYMENT_OVERDUE | 7 | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |
| PAYMENT_RECEIVED | 0 | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |

---

## 🔗 Referências

- [Documentação Oficial Asaas - Notificações](https://docs.asaas.com/reference/notifications)
- [API Asaas - Atualizar Notificação](https://docs.asaas.com/reference/atualizar-configuracao-de-uma-notificacao)

---

## 📝 Changelog

| Data | Versão | Alteração |
|------|--------|-----------|
| 2025-12-03 | 1.0.0 | Implementação inicial do módulo |
| 2025-12-03 | 1.0.1 | Correção dos valores de scheduleOffset para coincidir com Asaas |
| 2025-12-03 | 1.0.2 | Adição de WhatsApp aos canais de eventos pré-vencimento |
| 2025-12-03 | 1.0.3 | Correção do sync de scheduleOffset via POST /notifications/{id} |
| 2025-12-03 | 1.0.4 | Remoção de toast no auto-save (mantém apenas log) |
