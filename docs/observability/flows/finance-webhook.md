# Fluxo de observabilidade: webhook financeiro

## Caminho observado

1. `apps/web/app/api/webhooks/asaas/route.ts` valida request e limites, garante `x-request-id` e inicia o trace HTTP do Sentry.
2. Um span nomeado `finance.webhook.enqueue` cobre o enfileiramento; no modo síncrono, `finance.webhook.process_sync` cobre o handler. Drenagem inline tem seu próprio span limitado.
3. `packages/finance/src/webhooks/webhook-observability.service.ts` agrega contador e duração por categoria/resultado. Logs estruturados só são emitidos para erro de processamento.
4. O job `process-finance-webhooks` abre spans para preflight, processamento da fila e drenagem da outbox. A operação iniciada pelo job tem seu próprio trace.
5. O ID do evento (`eventId`) permanece como `correlationId` entre tentativas quando disponível. Sem evento externo, a linha persistida fornece o fallback estável durante retries. `requestId` e IDs de trace seguem independentes.
6. `getWebhookQueueMetrics` publica gauges globais a partir da mesma query agregada já usada por telas/jobs. Quando a leitura está filtrada por `contaId`, nenhuma métrica global é emitida.
7. A chamada HTTP de saída ao Asaas fica dentro da instrumentação Sentry do runtime. O logger do cliente Asaas mantém buffer de estatística local limitado a mil chamadas, com endpoint normalizado e sem IDs/erro bruto; logs stdout/Sentry são reservados a falha ou latência maior que 1s.

## Sinais disponíveis

- eventos processados/erro/sucesso/idempotente/skipped: `finance.webhook.processed`;
- eventos repetidos após primeira tentativa: `finance.webhook.retries`;
- eventos desconhecidos, rejeições de token, eventos críticos sem handler e lag da fila: contadores agregados por provider, com logs sanitizados e limitados a uma linha por minuto por evento/instância;
- duração de processamento: `finance.webhook.duration` (ms);
- backlog, pendentes, em processamento, erro, exauridos/DLQ, muitas tentativas, stuck e idade do mais antigo;
- itens recuperados do estado stuck e marcados DLQ durante preflight;
- chamadas Asaas, latência, rota, método, status e resultado;
- contagens/duração agregada por execução do job.

Todas as métricas de webhook usam o provider fixo e categoria/resultado com cardinalidade limitada. A identidade tenant não aparece nas dimensões.

## Garantias preservadas

- Esta instrumentação não muda a persistência-before-ack, as respostas HTTP, idempotência, retries, DLQ, isolamento `contaId` ou fonte de verdade financeira.
- Não há nova tabela, escrita de telemetria no Prisma ou consulta por evento para observabilidade.
- `correlationId` auxilia busca em logs; uma execução assíncrona abre novo trace e não é apresentada como continuação do request.
- Estado financeiro continua sujeito a webhook e reconciliação; métricas não atualizam estado financeiro.

## Verificação necessária em produção

No painel Sentry, confirme eventos e spans recebidos por `release`, ambiente e nome de operação; compare os totais com uma amostra de entregas/fila no banco. Faça a comparação por ambiente e período, sem exportar IDs de tenant. Esta conferência não pode ser substituída por `metrics/operational`, pois esse snapshot é local ao processo.
