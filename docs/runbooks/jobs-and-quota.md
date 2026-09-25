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

O cron `webhook-maintenance` executa apenas verificação por padrão. A remoção
de `removeBackoff`/recuperação de fila exige uma chamada administrativa com
`autoRepair=true`, após confirmar a causa do incidente e registrar a decisão.
Isso evita que uma rotina periódica reative uma fila do Asaas enquanto a causa
da interrupção ainda está presente.

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

O Asaas documenta uma quota geral de 25.000 chamadas por conta em cada janela
móvel de 12 horas e um limite de até 50 requisições `GET` concorrentes. Limites
específicos de endpoint também podem responder `429`; a resposta inclui
`RateLimit-Limit`, `RateLimit-Remaining` e `RateLimit-Reset` quando aplicável.
Trate `429` como sinal para reduzir concorrência/frequência e respeitar o tempo
de reset, sem retries imediatos em loop. Webhooks são a fonte normal de
atualização de pagamentos; consultas devem ser pontuais, limitadas e reservadas
para ação explícita do usuário ou reconciliação com orçamento. Referências:
[limites e quotas da API Asaas](https://docs.asaas.com/reference/rate-e-quota-limit) e
[polling versus webhooks](https://docs.asaas.com/docs/polling-vs-webhooks).

O webhook Asaas entrega eventos ao menos uma vez. Use o `id` do evento como
chave idempotente persistida; a Asaas considera a entrega confirmada somente
com HTTP 200 (outros códigos 2xx também geram retry). Responda depois de a inbox
gravar o evento, inclusive quando a chave já existir. Faça o processamento
financeiro fora do request de entrada e alerte para backlog, itens presos e
DLQ. Após 15 falhas consecutivas, a fila daquela configuração pode ser pausada;
os eventos ficam retidos por até 14 dias. Consulte [idempotência de webhooks](https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks),
[fila pausada](https://docs.asaas.com/docs/fila-pausada) e
[penalização de filas](https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas).

## Redis REST indisponível ou rejeitando rate limit

- Diferenciar falha de rede/autenticação de resposta `4xx` do comando Redis: um
  `PING` bem-sucedido confirma acesso ao endpoint, mas não valida scripts `EVAL`.
- Conferir os logs do limitador distribuído sem imprimir URL, token ou chave
  Redis. Registrar apenas status HTTP, categoria do erro do provedor, rota,
  deployment e janela temporal.
- Se `EVAL` falhar, reproduzir a operação Lua com uma chave temporária e
  namespaced, TTL curto e limite baixo; nunca usar uma chave de tenant real nem
  manter contador de teste depois da verificação.
- O webhook Asaas responde `503` em produção quando o rate limit distribuído
  falha fechado. Confirmar que as entregas foram reprocessadas após a
  recuperação, acompanhando a inbox e o backlog; não desligar o fail-closed
  para mascarar indisponibilidade do Redis.

## Credencial Asaas inválida

Quando a manutenção recebe `401`/credencial inválida de uma subconta, o estado
local é marcado como `apiKeyStatus=INVALID` e `operationalStatus=API_KEY_REQUIRED`.
As tentativas externas deixam de ser tratadas como retryable até a reconexão da
conta. A primeira transição para esse estado gera alerta crítico; execuções
posteriores não devem gerar uma nova tempestade de alertas.

## Contador de notificações

O contador é servido por cache por usuário/tenant. Em uma mesma instância, erros
concorrentes para a mesma chave são coalescidos em uma única consulta. A
persistência auxiliar de capacidades de WhatsApp é best-effort e não pode
derrubar a sincronização principal de notificações. Falhas de pool ficam
identificadas nos logs estruturados como `database_pool_timeout` ou
`database_pool_timeout_non_critical`.

## Pool de conexões Prisma

`DATABASE_URL` é a conexão usada pelo runtime; `DIRECT_URL` é reservada para
migrations e ferramentas que precisam de conexão direta. Se o provedor for Neon,
usar o endpoint pooled (`-pooler`) para o tráfego da aplicação e o endpoint
direct para `DIRECT_URL`. O pooler reduz conexões Postgres concorrentes, mas não
substitui o limite de conexões cliente do Prisma por instância.

Antes de definir `connection_limit`/`pool_timeout`, medir concorrência de
instâncias serverless e workers, revisar o limite real do compute e somar a
capacidade planejada de todas as funções que usam o banco. Não copiar um limite
genérico: o teto agregado inclui picos de autoscaling, jobs, workers e qualquer
outro consumidor. Validar com carga controlada, acompanhar sessões, espera por
conexão e timeouts no banco, e manter o orçamento abaixo da capacidade observada
com margem para administração e migrations. A aplicação reutiliza um singleton
Prisma por instância; conexões não são compartilhadas entre instâncias Vercel.

## Critério de saúde

Uma execução é saudável quando termina dentro de `maxDuration`, não possui
etapas falhas, mantém backlog dentro do SLO, não gera duplicidade financeira e
preserva isolamento Conta A/Conta B. Quota menor, isoladamente, não é critério
de sucesso.
