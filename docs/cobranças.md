# Cobranças (Avulsa, Parcelada, Assinatura)

## 1) Objetivo deste documento
Consolidar o estado atual implementado no módulo de cobranças da Alusa, com foco em:

- coerência de domínio entre avulsa, parcelamento e assinatura;
- criação/listagem sem mistura entre agregadores;
- sincronização robusta com Asaas via webhook;
- regras de pagamento disponíveis no wizard e no backend.

## 2) Estado final implementado

### 2.1 Regra de ouro
- Cada `payment.id` do Asaas deve mapear para **uma única cobrança local**.
- Webhook é o mecanismo principal para atualização de estado.
- Parcelamento e assinatura são agregadores; cobrança continua sendo a unidade financeira.

### 2.2 Wizard canônico
- O único modal de criação ativo é `CreateChargeModal.tsx`.
- Modais legados de criação separados foram removidos do fluxo.

Arquivo:
- `apps/web/components/financeiro/CreateChargeModal.tsx`

### 2.3 Matriz de formas de pagamento (vigente)

| Tipo | Métodos permitidos |
|---|---|
| `ONE_TIME` | `PIX`, `BOLETO`, `CREDIT_CARD`, `UNDEFINED` |
| `INSTALLMENT` | `BOLETO`, `CREDIT_CARD` |
| `SUBSCRIPTION` | `PIX`, `BOLETO`, `CREDIT_CARD`, `UNDEFINED` |

Essa matriz está alinhada no front e no backend (sem divergência UI/API).

Arquivos:
- `apps/web/components/financeiro/CreateChargeModal.tsx`
- `apps/web/app/api/finance/charges/standalone/route.ts`
- `packages/finance/src/use-cases/create-standalone-charge.ts`

## 3) Fluxos de criação

## 3.1 Cobrança avulsa (`ONE_TIME`)
1. Wizard envia payload para `POST /api/finance/charges/standalone`.
2. Backend resolve pagador e garante/reutiliza `customerId` (`ensureCustomer`).
3. Cria payment no Asaas.
4. Persiste cobrança local.
5. Webhook (`PAYMENT_CREATED`, etc.) mantém status sincronizado.

## 3.2 Parcelamento (`INSTALLMENT`)
1. Wizard envia `installmentCount` + valor + método.
2. Backend cria parcelamento no Asaas.
3. Parcela local é vinculada ao plano correto.
4. Listagens agregadas mostram somente parcelas do plano.
5. Progresso é protegido para não passar de 100%.

## 3.3 Assinatura (`SUBSCRIPTION`)
Há dois cenários:

- Assinatura acadêmica (com vínculo de matrícula/contrato), via rota específica:
  - `POST /api/finance/subscriptions`
- Assinatura manual/standalone via wizard canônico:
  - `POST /api/finance/charges/standalone` com `chargeType=SUBSCRIPTION`

Ambos os fluxos respeitam a matriz de billingType vigente.

## 4) Listagens e separação de contextos

## 4.1 Avulsas
- Página de avulsas lista apenas cobranças standalone à vista.
- Exclui itens de assinatura e parcelamento por filtros de vínculo e `externalReference`.

Arquivo:
- `packages/finance/src/use-cases/list-standalone-charges.ts`

## 4.2 Parcelamentos
- Lista agregada por plano (`ACADEMIC` e `STANDALONE`).
- Detalhe do parcelamento mostra somente parcelas daquele plano.
- Linhas de parcelas no detalhe direcionam para detalhe de cobrança individual.

Arquivos:
- `packages/finance/src/use-cases/list-installment-plans-aggregated.ts`
- `packages/finance/src/use-cases/get-installment-plan-detail.ts`
- `apps/web/app/(app)/cobrancas/parcelamentos/[id]/page.tsx`

## 4.3 Assinaturas
- Lista exibe assinaturas com dados enriquecidos.
- Coexistem assinaturas acadêmicas e manuais (`AVULSA`) com origem explícita.

Arquivo:
- `packages/finance/src/use-cases/list-subscriptions.ts`

## 5) Webhooks Asaas (robustez e idempotência)

## 5.1 Segurança
- Token de webhook validado por hash com comparação segura (`timingSafeEqual`).

Arquivo:
- `packages/finance/src/webhooks/asaas-webhook-handler.server.ts`

## 5.2 Idempotência
- Tratamento por `eventId`/payload no pipeline de webhook.
- Upsert por `asaasPaymentId` para impedir duplicidade de cobrança.
- Fallback controlado para reconciliação de vínculo por assinatura/parcelamento.

Arquivo:
- `packages/finance/src/webhooks/payment-webhook-handler.ts`

## 5.3 Vínculo automático por agregador
- Se payment vier com `subscription`, tenta vincular/gerar cobrança da assinatura correta.
- Se vier com `installment`, tenta vincular/gerar cobrança no plano correto.
- Quando necessário, cria item com marca de revisão (`NEEDS_REVIEW`) sem quebrar processamento.

## 6) Reuso de customer e regra de pagador
- Toda criação passa por resolução de pagador + `ensureCustomer`.
- Menor de idade depende de responsável financeiro quando aplicável.
- A base de integração com Asaas é o `customerId` resolvido/reatualizado.

Arquivo:
- `packages/finance/src/use-cases/ensure-customer.ts`

## 7) Notificações (Asaas)
- O sistema tenta sincronizar canais de notificação do cliente no Asaas em modo best-effort.
- Em ambiente sandbox, é esperado warning para WhatsApp (`sandbox_unsupported`), sem bloquear criação.

Arquivo:
- `packages/finance/src/services/customer-notification.service.ts`

## 8) Endpoints principais do fluxo

- `POST /api/finance/charges/standalone` (avulsa, parcelamento, assinatura manual)
- `GET /api/finance/charges/standalone` (lista avulsas standalone)
- `GET /api/finance/installments/aggregated`
- `GET /api/finance/installments/[id]`
- `POST /api/finance/subscriptions` (assinatura acadêmica)
- `GET /api/finance/subscriptions/enriched`
- `POST /api/webhooks/asaas`
- `GET /api/finance/charges/operational`

## 9) Boas práticas adotadas
1. Não inferir vínculo por prefixo textual sem chave canônica.
2. Preferir chave externa estável (`asaasPaymentId`, `asaasSubscriptionId`, `asaasInstallmentId`).
3. Webhook nunca deve falhar por caso de reconciliação pendente.
4. UI e backend devem compartilhar a mesma matriz de billingType por tipo.
5. Qualquer regra de exceção deve ser protegida por teste.

## 10) Checklist de regressão recomendado
1. Criar avulsa em todos os métodos permitidos e validar em Avulsas + Todas.
2. Criar parcelamento e validar agrupamento, detalhe e links de parcelas.
3. Criar assinatura com `PIX`, `BOLETO`, `CREDIT_CARD` e `UNDEFINED`.
4. Reprocessar `PAYMENT_CREATED` duplicado e confirmar ausência de duplicata local.
5. Confirmar que parcelas não aparecem em Avulsas.
6. Confirmar que assinatura não mistura cobranças de outro contexto.

## 11) Referências oficiais do Asaas
- Formas de cobrança: https://docs.asaas.com/docs/formas-de-cobranca
- Assinaturas: https://docs.asaas.com/docs/criando-uma-assinatura
- API de assinatura: https://docs.asaas.com/reference/create-new-subscription
- API de parcelamento: https://docs.asaas.com/reference/create-new-installment
- Webhooks: https://docs.asaas.com/docs/webhooks

## 12) Escalabilidade implementada (faseada e aditiva)

### 12.1 Ingestão assíncrona de webhook
- A rota `POST /api/webhooks/asaas` suporta modo assíncrono por flag `FIN_WEBHOOK_ASYNC_ENABLED=true`.
- Nesse modo, a rota faz ingestão rápida e enfileira em `WebhookAsaas`, com processamento posterior por worker.
- Processamento da fila usa `FOR UPDATE SKIP LOCKED`, evitando contenção e dupla execução concorrente.

Arquivos:
- `apps/web/app/api/webhooks/asaas/route.ts`
- `packages/finance/src/webhooks/asaas-webhook-handler.server.ts`
- `apps/web/app/api/jobs/process-finance-webhooks/route.ts`

### 12.2 Idempotência transacional e lock distribuído
- Escritas críticas usam guard transacional com advisory lock do Postgres.
- Conflitos previsíveis (`P2002`) são tratados com fallback de leitura, sem criar duplicidade.
- Header `X-Idempotency-Key` é aceito nas criações de cobrança/assinatura.

Arquivos:
- `packages/finance/src/core/idempotency.service.ts`
- `apps/web/app/api/finance/charges/standalone/route.ts`
- `apps/web/app/api/finance/subscriptions/route.ts`

### 12.3 Índices e estrutura para alta leitura
- Índices compostos adicionados para as listagens críticas e fila de webhook.
- Criada projeção denormalizada `ChargeReadModel`.
- Criada tabela fria `WebhookAsaasArchive` para ciclo de vida/retenção.

Arquivos:
- `prisma/schema.prisma`
- `prisma/migrations/20260207120000_finance_scalability_phase1/migration.sql`

### 12.4 Read model com shadow compare
- Listagem de avulsas pode usar `ChargeReadModel` via `FIN_READMODEL_ENABLED=true`.
- Shadow compare opcional com `FIN_READMODEL_SHADOW_COMPARE=true`.
- Webhook e casos de criação atualizam projeção de forma best-effort (sem travar fluxo principal).

Arquivos:
- `packages/finance/src/read-model/charge-read-model.service.ts`
- `packages/finance/src/use-cases/list-standalone-charges.ts`
- `packages/finance/src/webhooks/payment-webhook-handler.ts`

### 12.5 Observabilidade operacional
- Métricas de fila incluem backlog, lag, retries altos e processamento travado.
- Health admin inclui estado da fila além dos checks base.
- Endpoint de métricas de webhook agora retorna métricas agregadas + fila + gaps.

Arquivos:
- `packages/finance/src/webhooks/webhook-reconciliation.service.ts`
- `apps/web/app/api/admin/webhooks/metrics/route.ts`
- `apps/web/app/api/admin/financial/health/route.ts`

### 12.6 Retenção e reconciliação ativa
- Job de arquivamento: move webhooks antigos processados para `WebhookAsaasArchive`.
- Job de reconciliação com Asaas: compara e converge pagamentos/assinaturas; detecta drift em parcelamentos.
- Reconciliação usa endpoints oficiais: `payments/{id}`, `subscriptions/{id}`, `installments/{id}`, `installments/{id}/payments`.

Arquivos:
- `apps/web/app/api/jobs/archive-finance-webhooks/route.ts`
- `apps/web/app/api/jobs/reconcile-finance-webhooks/route.ts`
- `packages/finance/src/webhooks/webhook-reconciliation.service.ts`

## 13) Feature flags e operação
- `FIN_WEBHOOK_ASYNC_ENABLED`: ativa ingestão assíncrona de webhook.
- `FIN_READMODEL_ENABLED`: ativa leitura por projeção.
- `FIN_READMODEL_SHADOW_COMPARE`: compara leitura nova vs antiga em sombra.

## 14) Endpoints operacionais adicionados
- `POST /api/jobs/process-finance-webhooks`
- `POST /api/jobs/archive-finance-webhooks`
- `POST /api/jobs/reconcile-finance-webhooks`

---

Última atualização: 2026-02-07
