# Webhooks Asaas — Documentação Técnica

## Visão Geral

Este módulo implementa o processamento de webhooks do Asaas com:

- **Registry centralizado**: 73 eventos mapeados com categoria, handler e nível de impacto
- **Observabilidade estruturada**: Logs JSON, métricas e alertas
- **Replay administrativo**: Reprocessamento seguro de eventos
- **Blindagem financeStatus**: Apenas PAYMENT/SUBSCRIPTION alteram status financeiro

---

## Estrutura de Arquivos

```
packages/finance/src/webhooks/
├── asaas-webhook-handler.ts    # Handler principal (entry point)
├── asaas-event-registry.ts     # Registry de 73 eventos
├── webhook-observability.service.ts  # Logs e métricas
├── webhook-replay.service.ts   # Replay administrativo
├── handlers/
│   ├── payment.handler.ts      # PAYMENT_*
│   ├── subscription.handler.ts # SUBSCRIPTION_*
│   ├── transfer.handler.ts     # TRANSFER_*
│   ├── account.handler.ts      # ACCOUNT_STATUS_*
│   └── ...
└── __tests__/
    ├── asaas-event-registry.test.ts
    ├── webhook-critical-scenarios.test.ts
    └── finance-status-guard.test.ts
```

---

## Registry de Eventos

### Conceito

O `asaas-event-registry.ts` é a **fonte única da verdade** sobre quais eventos existem e como devem ser tratados.

```typescript
import { 
  isKnownEvent, 
  isHandledEvent, 
  getEventDefinition,
  getCriticalEvents 
} from './asaas-event-registry';
```

### Estrutura de um Evento

```typescript
{
  name: 'PAYMENT_RECEIVED',
  category: 'PAYMENT',
  description: 'Pagamento recebido',
  handled: true,
  handler: 'handlePayment',
  impactLevel: 'CRITICAL',
  requiresSync: true
}
```

### Categorias

| Categoria | Total | Handled | Critical |
|-----------|-------|---------|----------|
| PAYMENT | 26 | 26 | 13 |
| SUBSCRIPTION | 6 | 6 | 4 |
| TRANSFER | 7 | 3 | 1 |
| ACCOUNT_STATUS | 18 | 18 | 1 |
| INVOICE | 8 | 2 | 0 |
| BILL | 7 | 2 | 0 |
| ... | ... | ... | ... |

### Níveis de Impacto

- **CRITICAL**: Afeta fluxo financeiro principal (pagamentos, assinaturas)
- **HIGH**: Afeta operações financeiras secundárias
- **MEDIUM**: Informativo com impacto operacional
- **LOW**: Apenas registro/log

---

## Invariantes (NUNCA violar)

### 1. Eventos críticos DEVEM ter handler

```typescript
// Validado em CI
assertCriticalEventsCovered();
```

Todo evento com `impactLevel: 'CRITICAL'` deve ter `handled: true`.

### 2. financeStatus só via PAYMENT/SUBSCRIPTION

```typescript
// Bloqueado automaticamente
const result = await tryUpdateFinanceStatus({
  matriculaId: 'mat-123',
  newStatus: 'EM_DIA',
  eventCategory: 'TRANSFER', // ❌ Bloqueado
});
```

### 3. Idempotência obrigatória

Mesmo evento processado N vezes = mesmo resultado.

```typescript
// Verificar eventId antes de processar
const existing = await prisma.webhookEventLog.findUnique({
  where: { eventId: payload.event.id }
});
if (existing) return { success: true, skipped: true };
```

### 4. Webhook é fonte única de verdade financeira

Nunca inferir estado financeiro localmente. Aguardar evento oficial.

---

## Como Adicionar Novo Handler

### 1. Adicionar evento ao registry

```typescript
// asaas-event-registry.ts
{
  name: 'NOVO_EVENTO',
  category: 'PAYMENT',
  description: 'Descrição do evento',
  handled: true, // ← Marcar como handled
  handler: 'handlePayment',
  impactLevel: 'HIGH',
  requiresSync: false
}
```

### 2. Implementar lógica no handler

```typescript
// handlers/payment.handler.ts
case 'NOVO_EVENTO':
  await processNovoEvento(payload);
  break;
```

### 3. Adicionar teste

```typescript
// __tests__/payment.handler.test.ts
it('deve processar NOVO_EVENTO', async () => {
  // ...
});
```

### 4. Validar cobertura

```bash
pnpm --filter @alusa/finance test
```

---

## Observabilidade

### Logs Estruturados

Todo webhook gera log JSON:

```json
{
  "level": "info",
  "type": "webhook_processed",
  "timestamp": "2025-01-20T10:00:00.000Z",
  "eventId": "evt_123",
  "eventName": "PAYMENT_RECEIVED",
  "category": "PAYMENT",
  "handled": true,
  "critical": true,
  "durationMs": 45,
  "result": "success"
}
```

### Alertas

Alertas automáticos para:
- Evento crítico não tratado
- Evento desconhecido (não está no registry)
- Falha no processamento

### Métricas

```typescript
const metrics = calculateRegistryMetrics();
// {
//   total: 73,
//   handled: 59,
//   unhandled: 14,
//   percentHandled: 80.82,
//   byCategory: { ... }
// }
```

---

## Replay Administrativo

### Por eventId

```typescript
const result = await replayWebhookByEventId({
  eventId: 'evt_123',
  contaId: 'conta-xyz',
  adminId: 'admin-001',
});
```

### Por período

```typescript
const results = await replayWebhooksByDateRange({
  contaId: 'conta-xyz',
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-01-31'),
  adminId: 'admin-001',
});
```

### Regras de Replay

- ❌ Não permite replay de eventos `handled: false`
- ✅ Adiciona `source: 'REPLAY'` na auditoria
- ✅ Idempotente (reprocessar é seguro)

---

## Checklist de PR

Antes de fazer merge:

- [ ] Evento está no registry?
- [ ] `impactLevel` correto?
- [ ] `handled: true` se há lógica?
- [ ] Teste de idempotência existe?
- [ ] Log estruturado implementado?
- [ ] financeStatus usa guard?
- [ ] `pnpm --filter @alusa/finance test` passa?
- [ ] `assertCriticalEventsCovered()` passa?

---

## Troubleshooting

### Evento não está sendo processado

1. Verificar se está no registry
2. Verificar se `handled: true`
3. Verificar logs do handler

### Erro "Evento desconhecido"

Evento chegou mas não está mapeado:

1. Consultar docs Asaas
2. Adicionar ao registry
3. Decidir se precisa handler

### financeStatus não atualizando

Verificar se handler usa:

```typescript
import { updateFinanceStatusFromPayment } from '../guards';

await updateFinanceStatusFromPayment({
  matriculaId,
  newStatus: 'EM_DIA',
  eventName: 'PAYMENT_RECEIVED',
});
```

---

## Referências

- [Asaas Webhooks Docs](https://docs.asaas.com)
- [Documentação oficial Asaas](https://docs.asaas.com)
