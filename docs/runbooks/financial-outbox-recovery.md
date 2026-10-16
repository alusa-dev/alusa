# Recuperação segura de outboxes financeiros

Este runbook cobre somente os oito fluxos persistidos descritos na
[matriz de cobertura](../architecture/financial-outbox-coverage.md). Os estados
e ações são específicos de cada modelo; uma rota de drain não é equivalente a
uma ferramenta universal de replay.

## Antes de agir

1. Identifique a `Conta` e o modelo/owner no quadro de recuperação da matriz.
   Rotas administrativas derivam o tenant da sessão; não substitua esse escopo
   por um `contaId` copiado de outra fonte.
2. Comece por leitura. Para inbox de webhook há listagem DLQ e diagnostics
   tenant-scoped. Para modelos sem API de leitura por registro, peça ao owner
   uma triagem read-only em ferramenta já autorizada. O código revisado não
   fornece uma tela/API row-level para todos os outboxes.
3. Registre no sistema operacional autorizado a referência interna do evento,
   status, tentativas, disponibilidade/lease e erro sanitizado. Não copie
   payload, credenciais ou dados pessoais para logs/tickets genéricos.
4. Compare o estado Alusa com o estado do Asaas por um caminho de reconciliação
   existente, quando o tipo de recurso exigir. Não trate erro de worker como
   prova de que o POST remoto não ocorreu.
5. Só use replay/requeue/drain listado na matriz. Requeue e drains são
   mutações; um batch pode processar outros itens elegíveis da mesma conta.

### Limite do fencing nas outboxes de notificação Asaas

`claimToken` cerca as transições e finalizações da linha no banco; ele não
cancela nem cerca um PUT Asaas que já começou. Após uma lease stale ser
recuperada, a requisição do worker antigo ainda pode terminar e aplicar no
provedor uma seleção diferente da linha local, inclusive depois de a nova
tentativa marcar a linha `DONE`. Portanto, `DONE` confirma a conclusão local do
worker dono do claim atual, mas não prova por si só que a última escrita no
provedor corresponde ao estado local.

Para `AsaasNotificationPreferenceOutbox` e `AsaasNotificationSyncOutbox`,
compare as preferências remotas com o estado local antes de qualquer correção e
escale ao owner notifications/produto se houver divergência. Reparo automático
não está definido até produto decidir a precedência entre preferências de
eventos configuradas pela escola e canais selecionados na operação de cobrança.
Não invente uma replay genérica nem reenvie um PUT para “corrigir” o estado sem
essa decisão.

## Ações suportadas e estados sem replay

| Bounded context / modelo | Retry automático | Ação manual disponível | Estado sem replay explícito |
|---|---|---|---|
| Finance — `WebhookAsaas` | Scheduler processa `PENDENTE`/`ERRO`; backlog esgotado vira `EXAURIDO`. | Admin pode consultar `GET /api/admin/webhooks/dlq`; refileirar IDs ou até 200 itens com `POST /api/admin/webhooks/dlq`. `POST /api/admin/financial/webhooks/reprocess` só drena `ERRO` e exige justificativa. Replay auditado por event ID/data existe em `POST /api/admin/financial/webhooks/replay`. | Nenhum para a inbox com essas rotas. `force` no replay por event ID é restrito; não usar para contornar evento não suportado. |
| Finance — `FinanceWebhookSideEffectOutbox` | Scheduler reprocessa pendentes e recupera leases vencidas; tentativas retryable voltam a `PENDING`. | Nenhum replay por registro identificado. A reconstrução do scheduler para alguns efeitos de notificação ausentes não reabre um registro `EXHAUSTED`. | `EXHAUSTED`; escalar ao owner finance após verificar webhook de origem e estado remoto. |
| Finance — `MatriculaBillingOutbox` | Job `retry-enrollment-billing-provision` drena falhas elegíveis; limite atingido vira `REQUIRES_RECONCILIATION`. | Nenhum endpoint por evento. O helper `resumeReconciledEnrollmentTerminalIntent` não tem caller/API operacional identificado. | `REQUIRES_RECONCILIATION`, `CANCELLED` e `PROCESSED`. Escalar o primeiro; os demais são terminais de domínio. |
| Finance — `FamilyBillingOutbox` | Job de provisionamento processa `FAILED` e alguns `REQUIRES_RECONCILIATION` abaixo do limite. | `POST /api/admin/family-billing-outbox/drain` drena lote tenant-scoped de até 20; não aceita ID. Pode executar efeitos financeiros. | `REQUIRES_RECONCILIATION` com 8 tentativas ou mais não entra no batch. Não há replay direcionado por item. |
| Domain — `RematriculaOutbox` | `rematriculas-run` reprocessa falhas elegíveis abaixo do limite quando `availableAt` vence; o produtor de provisionamento futuro também pode reabrir uma falha deduplicada ao enfileirar a mesma intenção. | Nenhum endpoint administrativo por evento identificado; a rota catalogada continua sendo job em lote. | Falha no limite de tentativas permanece `FAILED` e não é selecionada; escalar ao owner domain. Re-enqueue é comportamento de produtor, não replay manual. |
| Notifications — `PendingInboxNotification` | O job processa `PENDING`, recupera lease vencida e tenta até o máximo persistido. | Nenhuma ação de replay por ID encontrada. | `FAILED`, inclusive payload inválido, origem inconsistente ou tentativas esgotadas. Escalar ao owner notifications. |
| Notifications — `AsaasNotificationPreferenceOutbox` | Job seleciona `PENDING`/`FAILED` vencidos e recupera PROCESSING stale; claim e finalização exigem o token de fencing atual no banco. O token não cancela PUT Asaas já iniciado, que pode terminar depois da recuperação. Retry limitado a oito tentativas. | A rota `apply-asaas-notification-preferences` executa o mesmo processamento tenant-scoped, não por ID. Um novo enqueue pode reabrir a chave para aplicar o estado atual. | `EXHAUSTED` exige triagem do erro e comparação do estado remoto/local. Não reabrir por SQL. `DONE` não garante que uma chamada antiga não tenha terminado depois. Sem decisão sobre precedência entre preferências de eventos da escola e seleção de canais da cobrança, não há reparo automático; escalar divergências ao owner. |
| Notifications — `AsaasNotificationSyncOutbox` | Job seleciona `PENDING`/`FAILED` vencidos e leases antigas abaixo de `maxAttempts`; claim e finalização exigem o token de fencing atual no banco. O token não cancela PUT Asaas já iniciado, que pode terminar depois da recuperação. | GET/POST de `process-asaas-notification-sync` pode drenar o lote tenant-scoped; não aceita ID. | `EXHAUSTED` não é selecionado. Comparar estado remoto/local e escalar ao owner notifications/produto; não alterar tentativas/status para reabrir. `DONE` não garante que uma chamada antiga não tenha terminado depois. Sem decisão sobre precedência entre preferências de eventos da escola e seleção de canais da cobrança, não há reparo automático. |

## Se não houver ação suportada

Pare antes de um novo drain/replay. Encaminhe a referência interna ao owner do
bounded context com a evidência mínima da triagem e solicite verificação
read-only. Para qualquer efeito externo incerto, primeiro confirme no Asaas se
ele existe e como está; a resposta deve ser reconciliada pelo fluxo de domínio
existente. Se não houver caminho de reconciliação ou replay demonstrado no
código, registre o caso como lacuna operacional para decisão do owner.

Não há procedimento SQL/Prisma manual neste runbook. Alterar status, contador,
lease, payload ou chave de deduplicação diretamente não é um mecanismo de
recovery suportado pelos serviços e pode criar efeitos duplicados ou cruzar
tenants.

## Fontes de código

- Rotas e catálogo: [`job-ownership.json`](../architecture/job-ownership.json),
  [`/api/admin/webhooks/dlq`](../../apps/web/app/api/admin/webhooks/dlq/route.ts),
  [`/api/admin/financial/webhooks/reprocess`](../../apps/web/app/api/admin/financial/webhooks/reprocess/route.ts),
  [`/api/admin/financial/webhooks/replay`](../../apps/web/app/api/admin/financial/webhooks/replay/route.ts),
  [`/api/admin/family-billing-outbox/drain`](../../apps/web/app/api/admin/family-billing-outbox/drain/route.ts).
- Services: [`dlq-admin.service.ts`](../../packages/finance/src/webhooks/dlq-admin.service.ts),
  [`finance-side-effect-outbox.service.ts`](../../packages/finance/src/webhooks/finance-side-effect-outbox.service.ts),
  [`enrollment-billing-outbox.service.ts`](../../apps/web/src/server/enrollments/enrollment-billing-outbox.service.ts),
  [`renewal-outbox.service.ts`](../../apps/web/src/server/enrollments/renewal-outbox.service.ts),
  [`processor.ts`](../../packages/finance/src/family-billing/processor.ts),
  [`pending-inbox-notifications.ts`](../../packages/lib/src/notifications/pending-inbox-notifications.ts),
  [`asaas-notification-preference-outbox.service.ts`](../../packages/finance/src/services/asaas-notification-preference-outbox.service.ts),
  [`asaas-notification-sync-outbox.service.ts`](../../packages/finance/src/services/asaas-notification-sync-outbox.service.ts).
