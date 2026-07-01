# Stripe Platform Billing Foundation

## Finalidade

A Stripe cobra assinaturas comerciais da Alusa, ou seja, a receita SaaS da empresa Alusa junto às escolas.

A Asaas continua responsável pelo financeiro educacional das escolas: cobranças de alunos e responsáveis, mensalidades, matrículas, contratos, Pix, boleto, subcontas, KYC, webhooks e reconciliação.

## Separação arquitetural

```txt
apps/web
    ↓
@alusa/platform-billing
    ↓
@alusa/stripe

@alusa/finance
    ↓
@alusa/asaas
```

Os dois fluxos não se dependem. `@alusa/stripe` não importa Prisma, Asaas ou finance. `@alusa/platform-billing` não importa Asaas, Asaas Gateway ou finance.

## Packages

- `@alusa/stripe`: adapter técnico server-side da Stripe. Valida `STRIPE_SECRET_KEY`, `STRIPE_ENVIRONMENT`, inicializa singleton do SDK oficial `stripe`, cria Customer, Checkout Session em modo `subscription`, Billing Portal Session, preview de alteração de assinatura, update de Price e `cancel_at_period_end`.
- `@alusa/platform-billing`: catálogo comercial da plataforma, tipos dos planos, política de acesso, limite de alunos, resolução segura de Stripe Price IDs, retry de webhooks, casos de uso server-side e store Prisma para persistência comercial.

## Persistência comercial

A integração adiciona models próprios, sem reutilizar `Subscription`, `Customer`, `Invoice` ou `Charge` do financeiro educacional:

- `PlatformBillingAccount`: vínculo da `Conta` com Customer/Subscription Stripe por ambiente (`TEST`/`LIVE`).
- `PlatformBillingCheckoutSession`: sessões de checkout criadas com idempotência por `contaId + environment + idempotencyKey`.
- `PlatformBillingInvoice`: faturas comerciais Stripe exibidas no histórico de faturamento da conta.
- `PlatformBillingWebhookEvent`: inbox técnico idempotente dos eventos Stripe por `environment + eventId`, com status `PENDING`, `PROCESSING`, `PROCESSED`, `FAILED`, `EXHAUSTED` e `IGNORED`.
- `PlatformBillingAuditLog`: trilha auditável para criação de Customer, Checkout e Portal.
- `PlatformBillingPlanChange`: mudanças comerciais de plano, cancelamento agendado e estado pendente até webhook.
- `PlatformBillingIssue`: divergências materializadas pela reconciliação.

As tabelas de dados da conta são tenant-scoped por `contaId`, têm FK para `Conta`, índices compostos iniciando por `contaId` e policy RLS `tenant_isolation` quando `app_security` existe. `PlatformBillingWebhookEvent` é técnico e pode receber evento antes de identificar a `Conta`.

## Planos iniciais

| Plano | Valor mensal | Limite |
| --- | ---: | ---: |
| Starter | R$ 149 | 60 alunos ativos |
| Premium | R$ 279 | 150 alunos ativos |
| Pro | R$ 499 | 300 alunos ativos |

Todos incluem Alusa completa, usuários internos ilimitados, professores ilimitados, cadastros históricos ilimitados e nenhum módulo bloqueado.

O plano `CUSTOM` representa contratação personalizada acima de 300 alunos e não fica disponível para checkout público nesta fase.

## Variáveis de ambiente

Obrigatórias para o adapter técnico:

- `STRIPE_SECRET_KEY`
- `STRIPE_ENVIRONMENT` (`TEST` ou `LIVE`)

Configuradas para fases futuras ou para resolver Price IDs sob demanda:

- `STRIPE_API_VERSION`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER_MONTHLY`
- `STRIPE_PRICE_PREMIUM_MONTHLY`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`
- `PLATFORM_BILLING_WORKER_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Price IDs são lidos do ambiente server-side. Nenhum Price ID arbitrário vindo do frontend deve ser aceito.

## Fluxos implementados

- Criar Customer Stripe da assinatura comercial da escola.
- Criar Checkout Session Stripe em `mode: subscription`, sempre usando Price ID resolvido no servidor.
- Reusar sessão local quando a mesma idempotency key for recebida.
- Criar Billing Portal Session para conta que já possui `stripeCustomerId`.
- Validar webhook Stripe com corpo bruto e `stripe-signature`.
- Persistir webhook Stripe em inbox e responder HTTP rapidamente.
- Processar `checkout.session.completed`, `customer.subscription.*` e `invoice.*` por worker assíncrono.
- Atualizar status comercial da conta por evento Stripe.
- Persistir invoices comerciais para histórico de faturamento.
- Rejeitar plano que não suporta a quantidade atual de alunos ativos.
- Contar alunos ativos por matrículas `ATIVA` e aluno `ATIVO`, usando `distinct alunoId`.
- Bloquear criação/ativação/reativação de matrícula que ultrapassa limite comercial, com advisory lock transacional por `Conta`.
- Agendar downgrade para o próximo ciclo e bloquear downgrade incompatível com alunos ativos.
- Solicitar upgrade via Stripe com `payment_behavior=pending_if_incomplete` e proration, consolidando plano superior somente por webhook.
- Agendar cancelamento no fim do período e reverter antes do encerramento.
- Aplicar política de acesso `PENDING`, `ACTIVE`, `GRACE_PERIOD`, `RESTRICTED`, `CANCELED`.
- Iniciar grace period de 7 dias em `invoice.payment_failed` e restaurar acesso em `invoice.paid`.
- Expirar grace period vencido para `RESTRICTED`, preservando billing/suporte e sem apagar dados.
- Reconciliar divergências locais/Stripe, corrigindo automaticamente somente assinatura com Price conhecido e materializando issues operacionais para ambiguidades.
- Registrar auditoria comercial local.
- Notificar administradores/financeiro em eventos críticos: checkout concluído, pagamento confirmado, pagamento falho, assinatura encerrada e grace expirado.

## Rotas e UI

- `GET /api/platform-billing/summary`: resumo privado da assinatura, planos, contagem de alunos ativos e invoices.
- `POST /api/platform-billing/checkout`: cria Checkout Session de assinatura.
- `POST /api/platform-billing/plan-change`: solicita upgrade ou agenda downgrade.
- `POST /api/platform-billing/cancel`: agenda ou desfaz cancelamento ao fim do período.
- `POST /api/platform-billing/portal`: cria Billing Portal Session.
- `POST /api/webhooks/stripe`: endpoint Stripe server-side em runtime `nodejs`.
- `POST /api/admin/platform-billing/webhooks/drain`: executa worker de webhooks.
- `GET /api/admin/platform-billing/webhooks`: lista eventos falhos/exauridos sem payload completo.
- `POST /api/admin/platform-billing/webhooks/replay`: devolve eventos falhos/exauridos para `PENDING`.
- `POST /api/admin/platform-billing/reconcile`: executa reconciliação corretiva.
- `POST /api/admin/platform-billing/plan-changes/apply`: aplica downgrades agendados vencidos.
- `POST /api/admin/platform-billing/grace-periods/apply`: expira grace periods vencidos.
- `POST /api/admin/platform-billing/maintenance`: executa drain de webhooks, downgrades vencidos, expiração de grace e reconciliação em uma rodada operacional.
- `/conta/plano-faturamento`: página dentro de Minha conta.

Somente papéis `ADMIN` e `FINANCEIRO` gerenciam ou visualizam faturamento comercial. O dropdown do header exibe "Plano e faturamento" para esses papéis.

A UI usa `InfoCallout` curto para atenção persistente na página. Alertas, confirmações de upgrade/downgrade/cancelamento e ações de regularização ficam em modais.

## Confiabilidade

- Checkout usa idempotência local e idempotency key enviada à Stripe.
- Webhook usa inbox persistente por `environment + eventId` para evitar reprocessamento.
- Worker usa claim atômico com `FOR UPDATE SKIP LOCKED`, timeout de `PROCESSING`, backoff exponencial com jitter e limite de tentativas.
- A inbox usa `LOCALTIMESTAMP` do Postgres para `nextAttemptAt` em criação/replay/retry, evitando atraso silencioso por offset de timezone em ambientes locais.
- Eventos permanentes ou com tentativas esgotadas vão para `EXHAUSTED` e podem ser reprocessados por replay administrativo auditado.
- Rate limit usa `rateLimitAsync`; quando `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` existem, usa Redis REST. Sem Redis, usa fallback em memória local.
- Secrets ficam server-side; não são enviados ao client nem registrados em log.

## Runbook operacional

- Assinatura ativa na Stripe e pendente na Alusa: executar `POST /api/admin/platform-billing/maintenance`; se persistir, executar reconciliação focada e verificar issue `PLAN_DIVERGENT_FROM_STRIPE_PRICE` ou `SUBSCRIPTION_RETRIEVE_FAILED`.
- Invoice paga sem liberação: confirmar evento `invoice.paid`; se estiver `FAILED`/`EXHAUSTED`, usar replay com motivo. Se ausente, reenviar evento no Dashboard Stripe test/live.
- Evento exaurido: listar em `GET /api/admin/platform-billing/webhooks?status=EXHAUSTED`, corrigir causa, usar replay limitado.
- Price desconhecido: configurar `STRIPE_PRICE_*` correto para o ambiente e rodar reconciliação. Não aceitar Price enviado pelo frontend.
- Customer duplicado: manter vínculo local canônico em `PlatformBillingAccount`; abrir issue manual antes de corrigir associação.
- Conta bloqueada incorretamente: verificar `accessStatus`, últimos eventos de invoice e `gracePeriodEndsAt`; usar reconciliação antes de alteração manual.
- Mistura TEST/LIVE: conferir `STRIPE_ENVIRONMENT`, prefixo da key (`sk_test`/`sk_live`) e Price IDs do ambiente.
- Webhook não recebido: validar endpoint `/api/webhooks/stripe`, `STRIPE_WEBHOOK_SECRET`, eventos assinados e logs `webhook_received`.
- Falha no Portal/Checkout: validar `STRIPE_SECRET_KEY`, Customer local, `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` e domínio de retorno.

## Go-live

- Criar Products e Prices LIVE manualmente no Dashboard Stripe.
- Configurar `STRIPE_ENVIRONMENT=LIVE`, `STRIPE_SECRET_KEY`, Price IDs LIVE, webhook LIVE e Portal LIVE.
- Garantir que o Customer Portal LIVE não permita downgrade/cancelamento fora das regras locais da Alusa.
- Configurar `PLATFORM_BILLING_WORKER_SECRET` e cron/job para `POST /api/admin/platform-billing/maintenance`.
- Rodar em modo observação para tenants legados: contas sem `PlatformBillingAccount` não são bloqueadas automaticamente.
- Ativar rollout gradual por grupo de Contas antes de aplicar cobrança comercial em massa.
- Plano de rollback: desabilitar ações de checkout/plan-change na UI, manter webhooks processando e não apagar dados.

## Comandos

```bash
pnpm install
pnpm --filter @alusa/stripe typecheck
pnpm --filter @alusa/stripe test
pnpm --filter @alusa/stripe build
pnpm --filter @alusa/platform-billing typecheck
pnpm --filter @alusa/platform-billing test
pnpm --filter @alusa/platform-billing build
pnpm typecheck
pnpm build
```

## Webhook Stripe

Configure no Dashboard Stripe, em modo test ou live conforme `STRIPE_ENVIRONMENT`:

```txt
POST https://SEU_DOMINIO/api/webhooks/stripe
```

Eventos mínimos:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.created`
- `invoice.finalized`
- `invoice.paid`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `invoice.marked_uncollectible`
- `invoice.voided`

Salve o signing secret em `STRIPE_WEBHOOK_SECRET`.

## Ainda não implementado

- Criação automatizada de Products/Prices LIVE a partir do app.
- Feature flag dedicada para rollout comercial por tenant.
- E2E completo com pagamento real de cartão de teste no navegador.

## Próxima fase sugerida

Criar rollout controlado de produção: feature flag por Conta, cron seguro para worker/reconciliação, dashboards de métricas e suíte E2E com Stripe CLI/sandbox.
