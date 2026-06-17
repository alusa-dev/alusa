# Plano: matrícula → cobrança automática (hardening)

Implementação incremental do plano de auditoria — **sem alterar UX/regras de negócio**.

## Entregas

| Fase | Item | Onde |
|------|------|------|
| 1 | `uiRequestId` + header `X-Idempotency-Key` | `Matricula`, DTO, `criarMatricula` |
| 1 | DTOs compartilhados `asaasSync` | `features/cadastro/matriculas/dtos` |
| 2 | Orquestrador `provisionIndividualEnrollmentBilling` | `enrollment-billing.orchestrator.ts` |
| 2 | `billingProvisionStatus` | schema + `billing-provision-status.ts` |
| 2 | Datas unificadas (`recurring-billing`) | `matricula.service.ts` |
| 3 | Outbox matrícula familiar | `matriculas/familiar/route.ts` + `enqueueFamilyBillingOutbox` |
| 3 | Job retry | `/api/jobs/retry-enrollment-billing-provision` |
| 4 | Compensação Asaas→DB | `create-subscription.ts` + `pendingAsaasSubscriptionId` |
| 4 | `reenviar-cobranca` → `createCharge` | route |
| 5 | Logs estruturados | `[enrollment-billing]` no orchestrator |

## Fluxo individual (inalterado funcionalmente)

```txt
POST /api/matriculas → criarMatricula → provisionIndividualEnrollmentBilling
  → taxa (createCharge) → gate → assinatura (createSubscription) → sync 1º ciclo
```

## Cron sugerido

`POST /api/jobs/retry-enrollment-billing-provision?contaId=...` (com auth cron)

Também drena `FamilyBillingOutbox` pendente.

## Rollback

- Migration additive (campos nullable exceto enum backfilled)
- Job desligável sem impacto no happy path
- Outbox: falha inline mantém resposta FALHO + evento PENDING para retry
