# Reconciliação financeira — Fases 2, 3 e 4

## Objetivo

Manter o Asaas como fonte soberana de estado financeiro e usar a reconciliação como safety net, sem transformar o cron em polling contínuo. O fluxo normal passa a ser:

```text
webhook Asaas → WebhookAsaas/inbox → handler idempotente → estado local/read model
                                      ↘ issue/auditoria
cron targeted → somente registros com verificação vencida ou nunca verificados
safety sweep → varredura ampla com frequência controlada e orçamento explícito
```

## Mudanças entregues

- Seleção de pagamentos por `lastProviderCheckAt`, em vez de consultar todo status local não-final a cada execução.
- Persistência de `lastProviderCheckAt` em assinaturas e planos de parcelamento.
- Cursor persistente `AsaasAccount.lastFinanceReconciliationAt`, ordenado por menor data, para fairness entre tenants.
- Concorrência por conta limitada a dois workers por padrão.
- Orçamento de chamadas Asaas e deadline por conta; o resultado informa quando o orçamento foi esgotado.
- O cursor de verificação só avança depois que a aplicação local confirma o snapshot; falha do handler permanece elegível para retry.
- Resultado do job com `outcome`, `correlationId`, duração, volume de chamadas, erros sanitizados e falhas por conta.
- Detecção de gaps em lote de webhooks, eliminando o N+1 por cobrança/assinatura.
- O antigo cron `reconcile-portal-finance` foi removido dos manifests; o endpoint legado delega ao mesmo job targeted.
- Os manifests Vercel usam `mode=targeted`, intervalo de 6 horas por registro, 100 chamadas por conta e concorrência 2.

## Operação

### Targeted (padrão)

```text
mode=targeted
providerCheckIntervalMinutes=360
maxAsaasCalls=100
accountConcurrency=2
maxDurationMs=100000
```

É o modo do cron de 30 minutos. A frequência do cron não significa frequência de chamada ao Asaas: cada registro só volta a ser elegível após o intervalo persistido.

### Safety sweep

Pode ser executado sob demanda ou em janela de manutenção:

```text
mode=safety_sweep&providerCheckIntervalMinutes=1440&maxAsaasCalls=100
```

O modo continua limitado por tenant e por execução. Ele não altera estado financeiro diretamente: divergências passam pelo handler/reconciliação idempotente.

## Métricas e critérios de sucesso

Observar no log estruturado do job e no exporter de API Asaas:

- `outcome`: `completed`, `partial`, `failed` ou `skipped`;
- `asaasCalls`, `budgetExhausted`, `durationMs` e `accountsFailed`;
- taxa de erro HTTP Asaas, especialmente 401, 404, 429 e 5xx;
- quantidade de `FinanceReconciliationIssue` aberta por `WEBHOOK_LAG` e drift;
- backlog/lag/DLQ de `WebhookAsaas`;
- ausência de aumento de duplicidades ou regressão de estado financeiro.

Canário recomendado: uma conta controlada por um ciclo completo, depois 10% das contas por quatro ciclos. Promover somente se não houver 5xx, duplicidade, vazamento cross-tenant, crescimento anormal de backlog ou aumento sustentado de 429.

## Rollback

1. Pausar o cron targeted no provedor de deploy.
2. Manter o scheduler de webhooks ativo para preservar a fonte principal de eventos.
3. Reexecutar manualmente apenas uma conta afetada com `dryRun=true` e orçamento baixo.
4. Investigar issues e erros classificados antes de qualquer replay.
5. Reverter o deploy apenas se houver regressão funcional; a migration é aditiva e não deve ser desfeita destrutivamente.

## Limites conhecidos

- A confirmação de que os webhooks estão recebendo eventos por tenant depende de dados reais de produção e deve ser feita pelo painel operacional/consultas de `WebhookAsaas`.
- A migration precisa ser aplicada antes do deploy do código que usa os novos campos.
- A rotação do token de webhook exposto no diagnóstico continua sendo uma ação operacional de produção, não uma alteração automática deste commit.
