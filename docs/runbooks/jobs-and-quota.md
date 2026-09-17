# Runbook de jobs, filas e quota

Este runbook orienta a operação dos jobs da Alusa sem alterar estado financeiro
manualmente ou bypassar o isolamento por `contaId`.

## Validação antes de publicar

```bash
pnpm workspace:check
pnpm validate:cron-config
pnpm audit:job-contracts
pnpm audit:route-boundaries
pnpm audit:http-contracts
pnpm security:check
pnpm --filter @alusa/finance typecheck
pnpm --filter @alusa/web typecheck
pnpm build:web
```

O catálogo de jobs está em
[`docs/architecture/job-ownership.json`](../architecture/job-ownership.json).
Qualquer alteração em `vercel.json` deve atualizar os dois manifests e o
catálogo; `pnpm audit:job-contracts` bloqueia divergências.

## Leitura operacional

Os jobs em Vercel devem produzir logs JSON com `type` igual a
`job_completed` ou `job_failed`, `jobName` e `durationMs`. Contagens de lote
devem ser usadas para separar execução vazia, trabalho real, retry e falha.
Não registrar payloads Asaas, tokens, e-mails ou mensagens de erro completas
quando não forem necessárias para a investigação.

Para cada incidente, verificar nesta ordem:

1. erro 5xx e duração no Vercel;
2. atraso/backlog da fila e itens `PROCESSING` antigos;
3. duplicidade esperada por idempotência versus falha funcional;
4. chamadas ao Asaas por conta e rate limit;
5. métricas do Neon: CPU, memória, locks, sessões e queries mais chamadas;
6. estado local e webhook recebido antes de qualquer reconciliação manual.

## Fila atrasada ou item preso

- Não apagar o item nem alterar status diretamente no banco.
- Confirmar `contaId`, `attempts`, `nextAttemptAt`/`availableAt` e lease.
- Executar o job de recuperação com limite pequeno e escopo explícito.
- Reprocessar DLQ apenas pela rota administrativa auditada.
- Confirmar que o webhook original foi persistido antes de reprocessar.

## Quota acima do esperado

- Comparar a janela com a baseline e separar `ncalls` de tempo total.
- Procurar execuções vazias, `COUNT(*)` de fila, polling de `sync-asaas` e
  drains duplicados.
- Reduzir frequência somente de manutenção e somente após confirmar o SLA de
  webhook/reconciliação.
- Não alterar simultaneamente timers críticos, migrations e compute.
- Reverter a menor mudança isolada se backlog, p95 ou erro aumentarem.

## Critério de saúde

Uma execução é saudável quando termina dentro de `maxDuration`, não possui
etapas falhas, mantém backlog dentro do SLO, não gera duplicidade financeira e
preserva isolamento Conta A/Conta B. Quota menor, isoladamente, não é critério
de sucesso.
