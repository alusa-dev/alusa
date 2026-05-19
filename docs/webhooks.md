# Webhooks Asaas — Arquitetura e Contrato Operacional

## Visão Geral

O sistema de webhooks da Alusa recebe eventos oficiais do Asaas para atualizar estados operacionais, registrar auditoria e disparar reconciliação quando necessário. Para domínios que o Asaas mantém como fonte transacional direta, como **saldo**, **extrato/ledger** e **antecipações**, a UI continua lendo a API oficial do Asaas e usa os webhooks como sinal de rastreabilidade, invalidação ou refetch.

Este contrato segue as recomendações oficiais do Asaas:
- webhooks têm entrega `at least once`, então todo handler precisa ser idempotente;
- o endpoint deve persistir o evento e responder `200` rapidamente;
- o processamento pesado deve ser assíncrono;
- o header `asaas-access-token` deve ser validado;
- o Asaas aguarda cerca de 10 segundos pela resposta, pausa a fila após falhas recorrentes e retém eventos por 14 dias.

## Hierarquia de Fonte de Verdade

O modelo operacional da integração segue esta ordem:
1. `webhook` é a fonte primária para transições locais de cobranças/assinaturas.
2. `read model` serve UI onde existe estado local seguro e idempotente.
3. `official read` consulta o Asaas quando a origem é saldo, ledger/extrato, antecipações ou documento autoritativo.
4. `command preflight` faz leitura oficial do Asaas apenas para validar comando crítico.
5. `reconciliation` corrige drift entre banco e Asaas.
6. `manual repair` existe para ação corretiva explícita.

Isso evita dois problemas clássicos:
- duplicar localmente ledger/saldo que já são fonte oficial do Asaas;
- usar sync corretivo como caminho feliz de produto.

### Gatilhos Permitidos por Categoria

| Categoria | Gatilho permitido | Gatilho proibido | Exemplo |
|---|---|---|---|
| `READ_MODEL` | `fresh=1`, snapshot ausente, snapshot incerto | recarregar toda tela sempre no Asaas | detalhe de cobrança |
| `COMMAND_PREFLIGHT_STATUS` | comando que depende só de status oficial | montar payload completo sem necessidade | receber em dinheiro |
| `COMMAND_PREFLIGHT_FULL` | comando que depende de valor, vencimento ou payload remoto | usar full read quando só o status basta | estorno |
| `RECONCILIATION` | drift detectado, webhook perdido, job de repair | resposta de UI no caminho feliz | `syncPaymentStateFromAsaas` |
| `MANUAL_REPAIR` | ação manual explícita de correção | fluxo normal de produto | sync de forma de pagamento |
| `AUTHORITATIVE_DOCUMENT` | geração de comprovante/link oficial | navegação de listagem/detalhe | comprovante do extrato |

### Fluxo de Recebimento

```
Asaas → POST /api/webhooks/asaas → Autenticação → Deduplicação → Enqueue/Process → Handler → Atualização de Estado
```

## Modos de Operação

### Modo Assíncrono (Produção)

Em produção, o modo assíncrono é **obrigatório**:

1. O webhook é recebido na rota `POST /api/webhooks/asaas`
2. O payload é validado (JSON, evento, token)
3. O evento é enfileirado na tabela `WebhookAsaas` com status `PENDENTE`
4. O Asaas recebe `200 OK` imediatamente
5. Um worker processa a fila ordenada por `recebidoEm ASC`

**Variáveis de ambiente:**

| Variável | Produção | Dev/Staging |
|----------|----------|-------------|
| `FIN_WEBHOOK_SYNC_OVERRIDE` | `true` para forçar sync (não recomendado) | n/a |
| `FIN_WEBHOOK_ASYNC_ENABLED` | n/a (sempre async) | `true` para ativar async |
| `FIN_WEBHOOK_INLINE_DRAIN` | `true` para processar inline (desabilitado por padrão) | `false` para desabilitar |

### Inline Drain

Em produção, o inline drain é **desabilitado por padrão**. O processamento da fila deve ser feito por um worker externo. Em dev, o inline drain está habilitado por padrão para facilitar testes locais.

### Preflight no cron de drain (produção)

O job `GET /api/jobs/process-finance-webhooks` (cron a cada 1 min) executa **preflight** antes do drain:

1. `recoverStuckWebhooks()` — reseta `PROCESSANDO` travados (> 5 min) para `ERRO`
2. `markExhaustedWebhooks()` — move tentativas esgotadas para `EXAURIDO` (DLQ)
3. `processAsaasWebhookQueueWithInbox()` — drain da fila
4. `drainFinanceWebhookSideEffectOutbox()` — entrega efeitos colaterais (inbox)

Use `?skipPreflight=true` apenas em debug operacional.

### Modo sequencial vs não sequencial (Asaas)

| Config Asaas | Quando usar | Impacto na Alusa |
|---|---|---|
| **Sequencial** | Cobranças/assinaturas com transições ordenadas | Fila Asaas bloqueia eventos posteriores se um falhar; manter resposta `200` rápida é crítico |
| **Não sequencial** | Eventos isolados (ex.: confirmação de transferência) | Maior vazão; ordem local garantida por `recebidoEm ASC` + precedência de status |

Recomendação: webhooks de **cobrança e assinatura** em modo sequencial; webhooks de **transferência/autorização** em não sequencial quando aplicável.

### Modo Síncrono (Dev)

Em dev/staging, o handler processa o webhook imediatamente na mesma request HTTP. Útil para desenvolvimento local.

## Autenticação

Cada subconta (instituição) possui um `webhookAuthToken` único. O token é enviado pelo Asaas no header da request.

### Headers aceitos

- `asaas-access-token`
- `x-asaas-access-token`
- `access_token`
- `access-token`

### Validação

1. O token é hasheado com SHA-256
2. Comparado com `webhookAuthTokenHash` na tabela `AsaasAccount` usando `timingSafeEqual`
3. O `contaId` é resolvido a partir da subconta correspondente

### Rejeições

Webhooks rejeitados (JSON inválido, token inválido, evento ausente) são:
- Persistidos na tabela **`WebhookAsaasRejection`** (sem FK para Conta — permite auditoria quando `contaId` é desconhecido)
- Logados via `alertTokenRejected()` com log estruturado JSON
- Retornados com HTTP `200` e `success: false` quando a rejeição é tratada/persistida pela rota, evitando retry infinito do Asaas para falhas permanentes. Bloqueios iniciais continuam retornando `403`, `429`, `415` ou `413` conforme a matriz operacional em `docs/runbooks/webhooks-asaas.md`.

> A tabela `WebhookAsaasRejection` foi criada separada da `WebhookAsaas` porque rejeições com token inválido não possuem `contaId` válido, e a FK obrigatória da tabela principal impedia a persistência. Campos: `id`, `contaId?` (nullable), `evento?`, `eventId?`, `payloadHash?`, `payload` (Json), `reason` (String), `recebidoEm`.

## Idempotência e Deduplicação

### Deduplicação Per-Tenant

A deduplicação é feita por **composite unique constraints**, isolada por tenant:

```prisma
@@unique([contaId, eventId], name: "uq_webhookasaas_conta_event")
@@unique([contaId, payloadHash], name: "uq_webhookasaas_conta_hash")
```

Isso garante que:
- Eventos com mesmo `eventId` de tenants diferentes não colidem
- Cada tenant tem seu próprio namespace de deduplicação
- `P2002` race conditions são tratadas com fallback para `findUnique` do compound key

### Fluxo de Deduplicação

1. Se `eventId` existe: busca por `{ contaId, eventId }`
2. Se não tem `eventId`: busca por `{ contaId, payloadHash }`
3. Se encontrado com status `PROCESSADO`: retorna 200 (idempotente)
4. Se encontrado com status `PROCESSANDO` ou `PENDENTE`: retorna 200 (já na fila)
5. Se não encontrado: cria novo registro

### Race Conditions

Em caso de requests simultâneas do mesmo evento:
- `P2002` (unique constraint violation) é capturado
- Fallback faz `findUnique` com compound key para encontrar o registro criado pela request concorrente

## Handlers por Categoria

| Prefixo do Evento | Handler | Entidades Afetadas |
|---|---|---|
| `PAYMENT_*` | `handlePaymentWebhook` | Cobrança, Charge, Lançamento |
| `SUBSCRIPTION_*` | `handleSubscriptionWebhook` | Subscription |
| `TRANSFER_*` | `handleTransferWebhook` | Transferência |
| `ACCOUNT_STATUS_*` | `handleAccountWebhook` | AsaasAccount |
| `INTERNAL_TRANSFER_*` | `handleInternalTransferWebhook` | Auditoria apenas |
| `RECEIVABLE_ANTICIPATION_*` | Auditoria no handler principal | AuditLog; estado é lido do Asaas sob demanda |
| `BALANCE_VALUE_*` | Notificação + auditoria | Alertas operacionais; saldo é lido do Asaas sob demanda |
| `INSTALLMENT_*` (via payment) | `handleInstallmentWebhook` | InstallmentPlan |
| Outros | Fallback (aceita, registra, sem efeito) | WebhookAsaas |

### Payment Handler — Precedência de Status

O sistema implementa **monotonic status progression**: uma vez que uma cobrança atinge um status terminal, ela não regride para um status anterior.

Exceções controladas:
- `PAYMENT_RESTORED`: permite `CANCELED → OPEN` (reativação explícita pelo Asaas)
- `PAYMENT_DELETED` com `deleted=true`: permitido sobre qualquer status (operação destrutiva do Asaas)

## Observabilidade

### Logs Estruturados

Cada evento processado gera um log JSON com:
- `eventName`, `eventId`, `category`, `handled`, `critical`
- `result` (SUCCESS, ERROR, IDEMPOTENT, SKIPPED)
- `durationMs`, `contaId`, `source`

### Alertas

| Função | Quando Dispara |
|---|---|
| `alertTokenRejected()` | Token de webhook não reconhecido |
| `alertIfUnhandledCritical()` | Evento crítico sem handler recebido |
| `alertIfUnknownEvent()` | Evento desconhecido (não no registry) |
| `alertQueueLagCritical()` | Lag da fila excede thresholds de retenção |

### Retention Alerts

O Asaas retém webhooks por 14 dias. O sistema avalia automaticamente o lag da fila após cada processamento:

| Nível | Threshold | Significado |
|---|---|---|
| INFO | ≥ 1h | Fila com atraso leve |
| WARNING | ≥ 24h | Ação recomendada |
| HIGH | ≥ 7d | Risco de perda de eventos |
| CRITICAL | ≥ 12d | Perda iminente (Asaas retém 14d) |

A avaliação é feita automaticamente em `processAsaasWebhookQueue()` após cada batch de processamento.

## Event Registry

Todos os 105 eventos oficiais do Asaas estão catalogados em `asaas-event-registry.ts` com:
- `category`: PAYMENT, SUBSCRIPTION, TRANSFER, ACCOUNT_STATUS, INVOICE, BILL, ANTICIPATION, PHONE_RECHARGE, CHECKOUT, BALANCE, INTERNAL_TRANSFER, ACCESS_TOKEN, PIX_AUTOMATIC
- `handler`: handler registrado ou null
- `handled`: boolean
- `impactLevel`: critical, high, medium, low, info

### Categorias e cobertura

| Categoria | Eventos | Handled | Descrição |
|---|---|---|---|
| PAYMENT | 29 | Sim | Cobranças e pagamentos |
| SUBSCRIPTION | 7 | Sim | Assinaturas/recorrência |
| TRANSFER | 7 | Sim | Transferências |
| ACCOUNT_STATUS | 18 | Sim | Status da conta/subconta |
| INTERNAL_TRANSFER | 2 | Sim | Transferências internas |
| INVOICE | 8 | Não | Notas fiscais (não usado na Alusa) |
| BILL | 7 | Não | Contas/pagamentos de boleto (não usado) |
| ANTICIPATION | 8 | Auditoria | Antecipações são lidas do Asaas sob demanda |
| PHONE_RECHARGE | 4 | Não | Recargas de celular (não usado) |
| CHECKOUT | 4 | Não | Links de pagamento (não usado) |
| BALANCE | 2 | Notificação | Bloqueio/desbloqueio de saldo |
| ACCESS_TOKEN | 6 | Notificação | Tokens de acesso (substitui API_KEY) |
| PIX_AUTOMATIC | 10 | Não | Pix automático/recorrente |

### Validação em CI

- `assertCriticalEventsCovered()`: falha se evento crítico não tem handler
- `validateCriticalEventsCoverage()`: retorna lista de violações

## Webhook Config Drift Service

Detecta e repara divergências entre a configuração de webhook local e o estado remoto no Asaas.

### Detecções

- URL incorreta
- Webhook desabilitado
- Webhook interrompido (penalizado)
- Token de autenticação ausente
- `sendType` incorreto
- Eventos faltando ou sobrando
- Hash local desatualizado

### Paginação

O serviço pagina a listagem de webhooks do Asaas (`GET /v3/webhooks`) automaticamente, buscando até 1000 webhooks (10 páginas de 100) para evitar falsos `REMOTE_NOT_FOUND` quando há muitos webhooks configurados.

### Auto-criação

Se o webhook não existe no Asaas (`REMOTE_NOT_FOUND`), o serviço cria automaticamente usando `POST /v3/webhooks` com a configuração esperada.

### Auto-reparo

- Remove backoff se interrompido/penalizado (`POST /v3/webhooks/{id}/removeBackoff`)
- Atualiza URL, eventos, token, sendType
- Habilita webhook se desabilitado
- Registra todas as ações no audit log

## Reconciliação

### Gap Detection

`detectWebhookGaps()`: identifica cobranças em estado não-final sem webhooks recentes (24h).

### Queue Metrics

`getWebhookQueueMetrics()`: métricas operacionais:
- `backlog`, `pending`, `processing`, `errored`, `processed`
- `highRetryBacklog` (tentativas ≥ 3)
- `stuckProcessing` (processando há mais de X minutos)
- `lagSeconds` (idade do evento mais antigo pendente)

### Recuperação de Webhooks Stuck

`recoverStuckWebhooks()`: recupera webhooks travados em status `PROCESSANDO` por mais tempo que o threshold (padrão: 5 minutos).

| Parâmetro | Default | Descrição |
|---|---|---|
| `contaId` | obrigatório | Tenant |
| `timeoutMinutes` | 5 | Tempo após o qual é considerado stuck |
| `limit` | 100 (max 500) | Máximo de webhooks a recuperar |

Webhooks identificados como stuck são resetados para status `ERRO` com mensagem descritiva, permitindo reprocessamento automático pela fila.

### Reconciliação com Asaas

`reconcileWithAsaas()`: verifica estado real no Asaas para cobranças/assinaturas com drift potencial.

- **Pagamentos**: evento sintético via `handlePaymentWebhook`
- **Assinaturas**: evento sintético via `handleSubscriptionWebhook` (mesma monotonicidade do webhook real)
- **Cron**: `GET /api/jobs/reconcile-finance-webhooks?includeGaps=true` a cada 30 min (multi-tenant, até 20 contas/execução)

### Outbox de efeitos colaterais

Notificações da inbox (`emitBillingNotifications`) são enfileiradas em `FinanceWebhookSideEffectOutbox` após processamento bem-sucedido do webhook, com dedupe por `(contaId, dedupeKey)` e drain no mesmo cron de fila. Falhas de inbox não revertem o estado financeiro já persistido.

## Reflexão de UI e Fonte Oficial

As telas financeiras usam leituras oficiais com `cache-control: no-store` onde o dado é transacional:
- **saldo**: `GET /api/financeiro/saldo` lê o saldo atual no Asaas;
- **extrato**: `getExtrato()` deriva a tela do ledger oficial do Asaas;
- **antecipações**: `listReceivableAnticipations()` lê status, taxas e previsão diretamente no Asaas.

Para melhorar a percepção de atualização sem duplicar estado financeiro, páginas sensíveis usam `useFinanceLiveRefresh()`:
- revalidação periódica leve;
- refetch quando o usuário volta para a aba (`visibilitychange`);
- refetch quando a janela ganha foco;
- refetch quando o navegador volta a ficar online.

Esse padrão é deliberadamente **pull/read-through**. Webhooks podem disparar auditoria, notificação e invalidação futura, mas não devem criar saldo, extrato ou antecipação local que contradiga o ledger oficial do Asaas.

### Archiving

`archiveProcessedWebhooks()`: move webhooks processados antigos para `WebhookAsaasArchive`.

## Reprocessamento

### Automático

- Eventos com status `ERRO` são reprocessados pela fila (até `FINANCE_WEBHOOK_REPROCESS_MAX_ATTEMPTS`, padrão: 5)
- Usa `FOR UPDATE SKIP LOCKED` para evitar processamento concorrente
- Após esgotar tentativas, são marcados como `EXAURIDO` pelo scheduler (DLQ)

### Manual

- `reprocessErroredAsaasWebhooks({ contaId })`: reprocessa eventos com erro de uma conta
- `replayWebhookByEventId()`: replay de evento específico
- `replayWebhooksByDateRange()`: replay em lote por janela de tempo

## Schema

### WebhookAsaas (tabela principal)

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | String (CUID) | ID interno |
| `contaId` | String | Tenant (isolamento) |
| `evento` | String | Nome do evento Asaas |
| `eventId` | String? | ID do evento no Asaas |
| `payloadHash` | String? | SHA-256 do body raw (`hashWebhookPayload`) |
| `payload` | JSON | Payload completo |
| `status` | String | PENDENTE, PROCESSANDO, PROCESSADO, ERRO, EXAURIDO, REJEITADO |
| `tentativas` | Int | Número de tentativas |
| `attemptsLog` | JSON? | Histórico de tentativas (últimas 20) |
| `asaasPaymentId` | String? | Correlação com payment |
| `asaasSubscriptionId` | String? | Correlação com subscription |
| `asaasTransferId` | String? | Correlação com transfer |

### Constraints

```prisma
@@unique([contaId, eventId])     -- dedup per-tenant por eventId
@@unique([contaId, payloadHash]) -- dedup per-tenant por hash
```

### WebhookAsaasArchive (arquivo frio)

Mesma estrutura, com campo `archivedAt` adicional. Sem constraints de unicidade (dados já validados).

### WebhookAsaasRejection (auditoria de rejeições)

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | String (CUID) | ID interno |
| `contaId` | String? | Tenant (nullable — token inválido = sem tenant) |
| `evento` | String? | Nome do evento (se disponível) |
| `eventId` | String? | ID do evento (se disponível) |
| `payloadHash` | String? | SHA-256 do payload |
| `payload` | JSON | Payload bruto completo |
| `reason` | String | Motivo da rejeição |
| `recebidoEm` | DateTime | Timestamp de recebimento |

> Sem FK para `Conta`. Indexes em `contaId` e `recebidoEm`.

## Segurança

- Tokens nunca são logados em texto claro
- Comparação de hash usa `timingSafeEqual` (constant-time)
- Payload máximo: 512KB
- Content-Type validado (application/json)
- Erros tratados/persistidos retornam 200 para evitar retries infinitos do Asaas
- Bloqueios iniciais da rota podem retornar 403, 429, 415 ou 413 antes de persistência/processamento
- Webhooks rejeitados persistidos para auditoria forense

## Casos de Borda Tratados

- **Webhook duplicado**: idempotência por `eventId` ou `payloadHash`
- **Webhook fora de ordem**: monotonic status progression
- **Race condition**: `P2002` com fallback
- **Token inválido**: persistido em `WebhookAsaasRejection` + alerta
- **JSON inválido**: persistido em `WebhookAsaasRejection`
- **Limite de tentativas**: marca como EXAURIDO (DLQ) após N tentativas. Disponível para replay manual.
- **Fila parada**: retention alerts com thresholds + SLO evaluation automática
- **Webhook stuck**: `recoverStuckWebhooks()` reseta para ERRO após timeout
- **Webhook interrompido**: auto-reparo via removeBackoff
- **Webhook missing**: auto-criação via drift service
- **Cross-tenant collision**: composite unique constraints

## Scheduler Unificado

O **Webhook Scheduler** (`webhook-scheduler.service.ts`) orquestra **todas as operações periódicas** de manutenção de webhooks em uma única execução, projetado para ser invocado por cron externo (Vercel Cron, AWS EventBridge, etc.).

### Rota de Execução

```
POST /api/jobs/webhook-scheduler
```

Auth: `x-cron-token` ou sessão ADMIN via `resolveTenantScope({ allowCron: true })`.

### Steps de Execução (em ordem)

| Step | Nome | Descrição |
|------|------|-----------|
| 1 | `recover_stuck` | Reseta webhooks travados em PROCESSANDO (>5min) para ERRO |
| 2 | `drain_queue` | Processa fila PENDENTE/ERRO com tenant-fair distribution |
| 3 | `mark_exhausted` | Move para DLQ (EXAURIDO) webhooks com ≥5 tentativas falhadas |
| 4 | `health_check` | Verificação remota de saúde do webhook + auto-recovery |
| 5 | `drift_check` | Drift detection + auto-repair de configuração remota |
| 6 | `archive` | Move webhooks processados antigos (>30d) para arquivo frio |
| 7 | `reconcile_asaas` | Reconciliação ativa com Asaas (opcional, requer `enableReconciliation=true` + `contaId`) |

### Query Params

| Parâmetro | Default | Descrição |
|-----------|---------|-----------|
| `contaId` | — | Processa apenas 1 conta |
| `drainLimit` | 200 (max 1000) | Máx de webhooks a processar |
| `skipHealthCheck` | false | Pula health check remoto |
| `skipDriftCheck` | false | Pula drift detection |
| `skipArchive` | false | Pula archiving |
| `enableReconciliation` | false | Ativa reconciliação com Asaas |

### Resultado

O scheduler retorna `WebhookSchedulerResult` com:
- `steps[]`: resultado de cada step (ok, durationMs, detail, error)
- `hasErrors`: se algum step falhou
- `retentionAlert`: alerta de retenção (lag + backlog)
- `slo`: avaliação de SLOs da fila

### Tenant-Fair Distribution

Quando `contaId` não é especificado, o drain usa **tenant-fair distribution**: seleciona 1 evento por tenant via `DISTINCT ON ("contaId")` antes de processar sequencialmente, evitando que um tenant monopolize o processamento.

## Dead Letter Queue (DLQ)

Webhooks que falharam repetidamente são movidos para status `EXAURIDO`.

### Regras

- Candidatos: status `ERRO` com `tentativas >= maxAttempts` (default: 5)
- Marcação feita por `markExhaustedWebhooks()` (step 3 do scheduler)
- Limite por execução: 200 (max 500)
- Webhooks EXAURIDO **não são reprocessados automaticamente**
- Permanecem disponíveis para replay manual e auditoria

### Status Flow

```
PENDENTE → PROCESSANDO → PROCESSADO (sucesso)
                       → ERRO (falha) → retry → ERRO → ... → EXAURIDO (DLQ)
```

## Worker Hardening

### Worker ID

Cada execução do drain recebe um `workerId` único no formato `w-{timestamp}-{random}`:
- Registrado em cada entrada do `attemptsLog`
- Permite rastrear qual execução processou qual evento
- Correlação para diagnóstico de concorrência

### Tenant-Fair Processing

O drain suporta `tenantFair: boolean`:
- `true` (padrão quando sem `contaId`): `SELECT DISTINCT ON ("contaId")` para distribuição justa
- `false` (quando `contaId` especificado): processamento sequencial por `recebidoEm ASC`

## SLOs (Service Level Objectives)

`evaluateWebhookSLOs()` avalia métricas da fila contra thresholds configuráveis.

### Thresholds Padrão

| Métrica | Threshold | Severity |
|---------|-----------|----------|
| `maxLagSeconds` | 300s (5min) | warning (>300s), critical (>900s) |
| `maxBacklog` | 500 | warning (>500), critical (>1000) |
| `maxErrorRate` | 5% | warning (>5%), critical (>10%) |
| `maxExhausted` | 10 | sempre critical |

### Resultado

`WebhookSLOResult`:
- `ok`: `true` se nenhuma violação
- `violations[]`: lista de violações com `metric`, `threshold`, `actual`, `severity`, `message`
- `thresholds`: thresholds aplicados
- `evaluatedAt`: timestamp da avaliação

### Integração

- Avaliado automaticamente no step de métricas pós-execução do scheduler
- Emite log estruturado com `type: "webhook_slo_violation"` quando há violações
- Resultado incluído em `WebhookSchedulerResult.slo`

## CI Gates

Testes automatizados (`webhook-slo-ci-gates.test.ts`) validam:

### SLO Evaluation
- OK quando métricas dentro dos limites
- Violações corretas para lag, backlog, error rate e exhausted
- Severity warning vs critical (3x threshold = critical)
- Thresholds customizáveis

### Registry Integrity (CI Gates)
- Métricas do registry são válidas (105 eventos, ≥60 handled)
- Nenhum evento crítico sem handler (`assertCriticalEventsCovered`)
- Cobertura por categoria ≥ 80% para categorias core
- Health status nunca CRITICAL

## Validação MCP (última execução)

- `GET /v3/webhooks`: **63 eventos provisionados** confirmados ✓ (atualizado de 37 → 63)
- Webhook ID: `428a39d9-721e-4b81-ae53-43f434fbd25c`
- Estado: `enabled=true`, `interrupted=false`, `penalizedRequestsCount=0`
- `hasAuthToken=true`, `sendType=SEQUENTIALLY`
- `PUT /v3/webhooks/{id}`: eventos atualizados com sucesso via MCP ✓
- `PUT /v3/webhooks/{id}` enum: 105 eventos confirmados na especificação oficial ✓
- `GET /v3/myAccount/status/`: contrato validado ✓
- `GET /v3/payments`: contrato de pagamentos validado ✓
- `GET /v3/subscriptions`: contrato de assinaturas validado ✓

## Testes de Webhook (180 testes)

| Arquivo | Testes |
|---------|--------|
| webhook-contract-scenarios | 26 |
| asaas-webhook-handler | 9 |
| webhook-critical-scenarios | 13 |
| subscription-webhook-handler | 8 |
| asaas-event-registry | 20 |
| account-webhook-event-contract | 19 |
| payment-webhook-handler | 5 |
| account-webhook-kyc | 9 |
| account-webhook-monotonicity | 5 |
| payment-resolver | 16 |
| installment-webhook-handler | 5 |
| webhook-reconciliation | 6 |
| webhook-health | 6 |
| asaas-event-contract-alignment | 8 |
| webhook-config-drift | 2 |
| webhook-slo-ci-gates | 14 |
| asaas-webhook-reprocess | 2 |
| internal-transfer-webhook-handler | 3 |
| transfer-webhook-handler | 2 |
| webhook-auth-token | 2 |
