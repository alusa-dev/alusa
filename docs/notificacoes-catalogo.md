# Catálogo — Inbox interna de notificações

Canal operacional para `ADMIN`, `FINANCEIRO` e `RECEPCAO`. Não confundir com notificações Asaas ao cliente nem portal do responsável.

## Financeiro (webhook / sync)

| eventKey | NotificationType | Gatilho | dedupeKey |
|----------|------------------|---------|-----------|
| `billing.payment.created` | `BILLING_CREATED` | Webhook `PAYMENT_CREATED`, sync | `billing:PAYMENT_CREATED:{asaasPaymentId}` |
| `billing.payment.overdue` | `BILLING_OVERDUE` | Webhook `PAYMENT_OVERDUE`, cron local | `billing:PAYMENT_OVERDUE:{id}` ou `billing:local-overdue:{id}:{date}` |
| `billing.payment.confirmed` | `PAYMENT_CONFIRMED` | Webhook recebido/confirmado, **todo** `syncPaymentStateFromAsaas` | `billing:PAYMENT_*:{asaasPaymentId}` |
| `billing.payment.refunded` | `PAYMENT_REFUNDED` | Webhook estorno | `billing:PAYMENT_REFUNDED:{asaasPaymentId}` |

**Retry:** se não existir `Cobranca`/`Charge` local, enfileira em `PendingInboxNotification` (job a cada 5 min).

## Matrícula

| eventKey | NotificationType | Gatilho |
|----------|------------------|---------|
| `enrollment.created` | `ENROLLMENT_CREATED` | POST `/api/matriculas` |
| `enrollment.renewed` | `ENROLLMENT_RENEWED` | POST `/api/rematriculas` |
| `enrollment.paused` | `ENROLLMENT_PAUSED` | POST `/api/matriculas/[id]/pausar` |
| `enrollment.resumed` | `ENROLLMENT_RESUMED` | POST `/api/matriculas/[id]/reativar` |
| `enrollment.cancelled` | `ENROLLMENT_CANCELLED` | PATCH status `CANCELADA` |

## Contratos

| eventKey | NotificationType | Gatilho |
|----------|------------------|---------|
| `contract.signed` | `CONTRACT_SIGNED` | Assinatura pública |
| `contract.cancelled` | `CONTRACT_CANCELLED` | DELETE contrato |
| `contract.expiring` | `CONTRACT_EXPIRING` | Cron 08:00 — 7, 3 e 1 dia(s) |
| `contract.expired` | `CONTRACT_EXPIRED` | Job `encerrar-contratos` |

## Aulas experimentais

| eventKey | NotificationType | Gatilho |
|----------|------------------|---------|
| `experimental.scheduled` | `EXPERIMENTAL_SCHEDULED` | Criação |
| `experimental.rescheduled` | `EXPERIMENTAL_RESCHEDULED` | Reagendamento |
| `experimental.completed` | `EXPERIMENTAL_COMPLETED` | Status realizada |
| `experimental.cancelled` | `EXPERIMENTAL_CANCELLED` | Status cancelada |

## Crons (Vercel)

| Job | Schedule | Função |
|-----|----------|--------|
| `process-finance-webhooks` | `* * * * *` | Fila Asaas + inbox |
| `process-pending-inbox-notifications` | `*/5 * * * *` | Retry entidade ausente |
| `process-overdue-billing-notifications` | `0 9 * * *` | Atrasados (fallback local) |
| `notify-contracts-expiring` | `0 8 * * *` | Contratos a vencer |
| `encerrar-contratos` | `30 4 * * *` | Expirados + notificação |

## Observabilidade

Logs estruturados `[Notifications][inbox.*]` via `logInboxMetric` em `packages/lib/src/notifications/inbox-metrics.ts`.
