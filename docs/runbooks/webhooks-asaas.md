# Runbook operacional: Webhooks Asaas

Este runbook cobre a Fase 0 de hardening operacional dos webhooks Asaas. Ele documenta verificações, cron/worker, drift, alertas mínimos e o contrato HTTP atual sem alterar handlers de pagamento, precedência de status, regras de cobrança ou payloads esperados do Asaas.

## Escopo

- Endpoint de entrada: `POST /api/webhooks/asaas`.
- Fila principal: tabela `WebhookAsaas`.
- Rejeições/auditoria sem tenant resolvido: tabela `WebhookAsaasRejection`.
- Worker standalone: `packages/finance/src/workers/webhook-worker.ts`.
- Scheduler/cron: `POST /api/jobs/webhook-scheduler`.
- Drain legado/dedicado: `POST /api/jobs/process-finance-webhooks`.

Fora do escopo: mudanças em `Cobranca`, `Charge`, `Subscription`, reconciliação financeira e precedência de status.

## Baseline de banco

A migração `prisma/migrations/20260402035847_add_loja_models/migration.sql` remove o índice único global `WebhookAsaas_payloadHash_key` e cria unicidade por tenant:

- `WebhookAsaas_contaId_eventId_key` em `("contaId", "eventId")`.
- `WebhookAsaas_contaId_payloadHash_key` em `("contaId", "payloadHash")`.

Antes de qualquer deploy ou migração relacionada a webhooks, rode as queries abaixo em staging e produção.

### Índices reais de `WebhookAsaas`

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'WebhookAsaas'
ORDER BY indexname;
```

Resultado esperado:

- Existe `WebhookAsaas_contaId_eventId_key`.
- Existe `WebhookAsaas_contaId_payloadHash_key`.
- Nao existe `WebhookAsaas_payloadHash_key`.

### Checagem objetiva dos índices esperados

```sql
SELECT
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE tablename = 'WebhookAsaas'
      AND indexname = 'WebhookAsaas_contaId_eventId_key'
  ) AS has_conta_event_id_unique,
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE tablename = 'WebhookAsaas'
      AND indexname = 'WebhookAsaas_contaId_payloadHash_key'
  ) AS has_conta_payload_hash_unique,
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE tablename = 'WebhookAsaas'
      AND indexname = 'WebhookAsaas_payloadHash_key'
  ) AS has_global_payload_hash_unique;
```

Resultado esperado:

```text
has_conta_event_id_unique = true
has_conta_payload_hash_unique = true
has_global_payload_hash_unique = false
```

### Duplicatas que bloqueariam constraints por tenant

Use antes de recriar índices ou corrigir bancos antigos.

```sql
SELECT
  "contaId",
  "eventId",
  COUNT(*) AS total
FROM "WebhookAsaas"
WHERE "eventId" IS NOT NULL
GROUP BY "contaId", "eventId"
HAVING COUNT(*) > 1
ORDER BY total DESC, "contaId", "eventId";
```

```sql
SELECT
  "contaId",
  "payloadHash",
  COUNT(*) AS total
FROM "WebhookAsaas"
WHERE "payloadHash" IS NOT NULL
GROUP BY "contaId", "payloadHash"
HAVING COUNT(*) > 1
ORDER BY total DESC, "contaId", "payloadHash";
```

### Colisao indevida causada por índice global antigo

Esta query identifica hashes iguais entre tenants diferentes. Isso deve ser permitido pelo modelo atual; se o índice global antigo existir, ele pode bloquear inserts válidos.

```sql
SELECT
  "payloadHash",
  COUNT(*) AS total_registros,
  COUNT(DISTINCT "contaId") AS total_contas
FROM "WebhookAsaas"
WHERE "payloadHash" IS NOT NULL
GROUP BY "payloadHash"
HAVING COUNT(DISTINCT "contaId") > 1
ORDER BY total_contas DESC, total_registros DESC;
```

## Worker, scheduler e drift

Em produção, o webhook deve responder rápido e deixar o processamento pesado para a fila.

### Worker standalone

O worker standalone fica em `packages/finance/src/workers/webhook-worker.ts` e pode rodar como processo separado, container dedicado ou função periódica.

Comando base:

```bash
npx tsx packages/finance/src/workers/webhook-worker.ts
```

Variáveis principais:

| Variável | Default | Uso |
|---|---:|---|
| `WEBHOOK_WORKER_INTERVAL_MS` | `5000` | Intervalo entre ciclos em modo loop. |
| `WEBHOOK_WORKER_DRAIN_LIMIT` | `50` | Máximo de eventos processados por ciclo. |
| `WEBHOOK_WORKER_CONTA_ID` | vazio | Restringe a um tenant quando necessário. |
| `WEBHOOK_WORKER_MODE` | `loop` | Use `once` para execução pontual. |
| `WEBHOOK_WORKER_ENABLE_SCHEDULER` | `true` | Executa manutenção periódica dentro do worker. |
| `WEBHOOK_WORKER_SCHEDULER_CYCLES` | `12` | Frequência do scheduler interno em ciclos. |

Observação operacional importante: quando o worker chama o scheduler interno, ele usa `skipDriftCheck: true`. Isso é intencional para o worker não fazer drift remoto em ciclos frequentes. Deve existir outro cron cobrindo drift.

### Scheduler unificado

Rota:

```text
POST /api/jobs/webhook-scheduler
```

Autenticação: `x-cron-token` ou sessão admin via `resolveTenantScope({ allowCron: true })`.

Passos executados:

| Step | Finalidade |
|---|---|
| `recover_stuck` | Reseta webhooks travados em `PROCESSANDO` para `ERRO`. |
| `drain_queue` | Processa `PENDENTE` e `ERRO` com distribuição justa por tenant. |
| `mark_exhausted` | Marca eventos que excederam tentativas como `EXAURIDO`. |
| `health_check` | Verifica saúde remota e tenta auto-recovery. |
| `drift_check` | Detecta/repara URL errada, webhook desabilitado, penalização, token ausente, `sendType` e eventos divergentes. |
| `archive` | Arquiva eventos processados antigos. |
| `reconcile_asaas` | Opcional; somente com `enableReconciliation=true` e `contaId`. |

Checklist de cron:

- Cron frequente para drain/manutenção: chamar `POST /api/jobs/webhook-scheduler` sem `skipDriftCheck=true`, salvo se houver cron dedicado de drift.
- Se o worker standalone for o dreno principal, manter um cron separado para `POST /api/jobs/webhook-scheduler?drainLimit=1` sem `skipDriftCheck=true` em cadência mais baixa.
- Nao usar somente `POST /api/jobs/process-finance-webhooks` como job de produção, pois ele apenas drena a fila e nao cobre drift, DLQ, health check e archiving.
- Validar que `x-cron-token` está configurado no provedor de cron e na aplicação.
- Confirmar que o worker não depende de inline drain em produção.

## Matriz HTTP atual

A rota `POST /api/webhooks/asaas` tem uma política deliberada: depois que a request passa pelos bloqueios iniciais e o evento pode ser tratado/persistido, a resposta é `200` mesmo quando o body vem com `success: false`. O objetivo é evitar retry infinito do Asaas para falhas permanentes ou já registradas internamente.

| Situação | HTTP atual | Body típico | Observação |
|---|---:|---|---|
| IP bloqueado por modo strict | `403` | `{ success: false, error: 'FORBIDDEN' }` | Só bloqueia quando `shouldBlockAsaasWebhookByIp()` decide bloquear. Allowlist é diagnóstica por padrão. |
| Rate limit por IP | `429` | `{ success: false, error: 'RATE_LIMITED' }` | Inclui header `Retry-After`. |
| `Content-Type` não JSON | `415` | `{ success: false, error: 'UNSUPPORTED_MEDIA_TYPE' }` | Bloqueio antes de ler/processar payload. |
| Payload acima de 512KB | `413` | `{ success: false, error: 'PAYLOAD_TOO_LARGE' }` | Bloqueio por `content-length` ou tamanho real do body. |
| Evento aceito/enfileirado/processado | `200` | `{ success: true, mode: 'QUEUE' | 'SYNC' }` | Caminho feliz. |
| Token inválido/ausente tratado pelo handler | `200` | `{ success: false, error: ... }` | Deve ficar registrado em `WebhookAsaasRejection` quando aplicável. |
| JSON inválido tratado pelo handler | `200` | `{ success: false, error: ... }` | Política atual evita retry externo infinito. |
| Falha lógica persistida na fila | `200` | `{ success: false, error: ... }` | Reprocessamento é interno via fila/DLQ. |
| `ASAAS_WEBHOOK_AUTH_TOKEN_SECRET` ausente | `200` | `{ success: false, error: 'ENV_NOT_CONFIGURED' }` | Falha operacional de configuração. |
| Exceção inesperada na rota | `200` | `{ success: false, error: 'ERRO_INTERNO' }` | A rota loga erro e evita retry infinito do Asaas. |

Qualquer mudança para `400`/`401` em token inválido ou JSON impossível deve entrar atrás de feature flag, por exemplo `ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS`, com rollout em staging e monitoramento de penalização no Asaas antes de produção.

## Alertas mínimos

Configure alertas, painel ou queries agendadas para estes sinais.

### Lag e backlog da fila

```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'PENDENTE') AS pending,
  COUNT(*) FILTER (WHERE status = 'PROCESSANDO') AS processing,
  COUNT(*) FILTER (WHERE status = 'ERRO') AS errored,
  COUNT(*) FILTER (WHERE status = 'EXAURIDO') AS exhausted,
  EXTRACT(EPOCH FROM (NOW() - MIN("recebidoEm") FILTER (WHERE status IN ('PENDENTE', 'ERRO'))))::bigint AS lag_seconds
FROM "WebhookAsaas";
```

Thresholds mínimos:

| Sinal | Info | Warning | High | Critical |
|---|---:|---:|---:|---:|
| `lag_seconds` | `>= 3600` | `>= 86400` | `>= 604800` | `>= 1036800` |
| `pending` | tendência anormal | crescimento sustentado | sem queda após worker | fila parada |
| `errored` | qualquer pico | crescimento sustentado | alta recorrência por tenant | erro sistêmico |
| `exhausted` | qualquer novo item | mais de 0 sem triagem | recorrente | perda operacional provável |

O Asaas retém eventos por 14 dias. `lag_seconds >= 1036800` equivale a 12 dias e exige ação imediata.

### Rejeições de token e payload

```sql
SELECT
  reason,
  COUNT(*) AS total,
  MIN("recebidoEm") AS first_seen,
  MAX("recebidoEm") AS last_seen
FROM "WebhookAsaasRejection"
WHERE "recebidoEm" >= NOW() - INTERVAL '1 hour'
GROUP BY reason
ORDER BY total DESC;
```

Alertar quando houver pico de rejeições por token ausente/inválido, pois pode indicar URL errada, token rotacionado sem cutover ou tráfego indevido.

### Penalização/drift de configuração

O scheduler deve cobrir `health_check` e `drift_check`. Alertar quando o resultado do scheduler indicar:

- `driftsFound > 0`.
- `driftsRepaired > 0`.
- Falha no step `health_check`.
- Falha no step `drift_check`.
- Webhook remoto interrompido/penalizado.

## Runbook de incidentes

### Fila PENDENTE crescendo

1. Verificar se o worker standalone está rodando ou se o cron `POST /api/jobs/webhook-scheduler` está executando.
2. Rodar query de lag/backlog.
3. Checar logs de `[webhook-worker]` e do step `drain_queue`.
4. Se houver `PROCESSANDO` antigo, confirmar execução de `recover_stuck`.
5. Se `ERRO` crescer, inspecionar `ultimoErro` por tenant antes de replay manual.

```sql
SELECT
  "contaId",
  status,
  "ultimoErro",
  COUNT(*) AS total,
  MIN("recebidoEm") AS oldest
FROM "WebhookAsaas"
WHERE status IN ('PENDENTE', 'PROCESSANDO', 'ERRO', 'EXAURIDO')
GROUP BY "contaId", status, "ultimoErro"
ORDER BY oldest ASC
LIMIT 50;
```

### Webhook penalizado no Asaas

1. Confirmar se o scheduler sem `skipDriftCheck=true` está ativo.
2. Checar step `health_check` e `drift_check`.
3. Validar URL remota, token e eventos esperados.
4. Se o auto-repair não resolver, remover penalização pelo painel/API Asaas conforme procedimento operacional e rodar o scheduler novamente.
5. Monitorar `pending`, `errored`, `exhausted` e novas rejeições.

### Token ausente ou inválido em pico

1. Verificar `WebhookAsaasRejection` por `reason` e janela.
2. Confirmar se houve rotação recente de `webhookAuthToken`.
3. Validar se o webhook remoto aponta para a URL correta e envia o header esperado.
4. Nao trocar comportamento HTTP em produção durante o incidente sem feature flag e plano de rollback.

### URL errada ou drift remoto

1. Rodar ou aguardar `POST /api/jobs/webhook-scheduler` sem `skipDriftCheck=true`.
2. Conferir resultado `driftsFound` e `driftsRepaired`.
3. Verificar se o webhook remoto foi atualizado para a URL pública correta.
4. Validar recebimento de novo evento em `WebhookAsaas`.

### DLQ/EXAURIDO

1. Listar eventos `EXAURIDO` por tenant e erro.
2. Confirmar se a causa raiz foi corrigida antes de replay manual.
3. Reprocessar somente eventos necessários via ferramenta/admin de replay já existente.
4. Registrar decisão operacional quando o evento não deve ser reprocessado.

## Checklist de deployment

- Índices reais validados em staging e produção.
- Query de duplicatas por `(contaId, eventId)` e `(contaId, payloadHash)` sem resultados inesperados.
- Worker standalone ou cron de scheduler ativo para drenar `PENDENTE`/`ERRO`.
- Existe execução de drift check sem `skipDriftCheck=true`.
- Inline drain não é dependência operacional em produção.
- Alertas mínimos de `lag_seconds`, `pending`, `errored`, `exhausted` e `WebhookAsaasRejection` configurados.
- `x-cron-token` configurado no cron e na aplicação.
- Política HTTP atual comunicada ao time: `200` para falhas persistidas; `403/429/415/413` para bloqueios iniciais.
- Nenhuma mudança em handlers de pagamento, precedência de status, payloads Asaas ou regras financeiras.

## Critérios de aceite

- Este runbook existe em `docs/runbooks/webhooks-asaas.md`.
- O runbook inclui queries para validar os índices reais de `WebhookAsaas` em staging e produção.
- O runbook documenta que o índice global `WebhookAsaas_payloadHash_key` não deve existir.
- O runbook documenta worker standalone, scheduler, drift check e o risco de usar worker com `skipDriftCheck: true` como única manutenção.
- O runbook documenta alertas mínimos para lag, backlog, erros, DLQ e rejeições.
- O runbook documenta a matriz HTTP atual de `POST /api/webhooks/asaas`.
- O runbook deixa explícito que endurecimento HTTP para `400`/`401` exige feature flag e rollout.
- Nenhum arquivo de domínio financeiro, handler, schema Prisma ou rota foi alterado nesta fase.
