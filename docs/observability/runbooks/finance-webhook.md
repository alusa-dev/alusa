# Runbook: falha ou atraso no webhook financeiro

## 1. Avaliar o impacto

- No Sentry, filtre serviço `alusa-web`/`alusa-finance`, ambiente e release; procure `finance.webhook.processing.failed`, falhas do job ou span `finance.webhook.queue.process`.
- Confira os sinais de backlog, falhas, retries, stuck, DLQ e `oldest_pending_age`. Um trace amostrado é evidência de uma execução, não um contador total.
- `GET /api/admin/webhooks/metrics/operational` só mostra um snapshot local da instância e está restrito a `SUPER_ADMIN`; não use esse endpoint para concluir que a fila global está vazia.

## 2. Correlacionar com segurança

- Use `requestId` para a entrega HTTP inicial e `correlationId` para encontrar a operação/evento em tentativas posteriores.
- Use `traceId`/`spanId` para percorrer a execução técnica capturada pelo Sentry.
- Não copie token, payload, CPF, e-mail, aluno, responsável ou chave de conta para uma busca/alerta. Métricas não são indexadas por `contaId`.

## 3. Recuperar

- Verifique o estado persistido pela rota tenant-scoped de diagnóstico/reconciliação e confirme o `contaId` a partir da sessão/escopo autorizado.
- Se eventos estiverem pendentes/erro, confirme saúde do worker e variáveis de fila; o job possui preflight de recuperação e DLQ.
- Para evento exaurido, siga o procedimento de replay/reconciliação financeira existente. Não altere estado de cobrança manualmente por causa de uma métrica.
- Confirme resultado pelo estado local reconciliado e pelo webhook/reconciliação do Asaas antes de encerrar incidente.

## 4. Se a telemetria estiver indisponível

- Processamento de negócio é fail-safe: o sink Sentry não impede enqueue/handler/job. Confira a fila e os logs estruturados de stdout no provider.
- Não crie tabela ou loop de retry de telemetria no banco. Repare DSN/release/exporter e compare eventos futuros; a perda de telemetria não deve duplicar cobrança.

## 5. Escalonar

Escalone ao responsável por Finance/Webhooks quando backlog/idade ultrapassar o SLO acordado, surgir crescimento sustentado de DLQ, repetição de falha por operação ou divergência entre estado financeiro e Asaas. Os limiares ainda precisam ser definidos com baseline e impacto financeiro real.
