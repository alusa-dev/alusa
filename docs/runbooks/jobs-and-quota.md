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
pnpm typecheck
pnpm build:web
```

O catálogo de jobs está em
[`docs/architecture/job-ownership.json`](../architecture/job-ownership.json).
Para a revisão individual das agendas, limites, origens de trabalho, recuperação
e gaps de SLA, consulte a [matriz auditável de schedules](../architecture/job-schedule-review.md).
Qualquer alteração em `vercel.json` deve atualizar os dois manifests e o
catálogo; `pnpm audit:job-contracts` bloqueia divergências.

Na configuração local inspecionada em 16/10/2026, `apps/web/vercel.json`
contém 36 crons; o manifest raiz também contém 36, mas são arquivos de
deployments distintos e não uma agenda de 72 jobs. Expandindo as expressões
cron do manifest do app por frequência, o total planejado é 5.057 disparos por
dia: 4.932 em schedules intervalares, 120 em cinco horários fixos por hora e
5 em cinco horários diários. A estimativa descreve somente a agenda
configurada. Para saber
execuções efetivas e trabalho útil, correlacione logs de deployment/runtime e
contagens de itens processados/ignorados; a configuração local não valida a
agenda ativa em produção.

### Snapshot Neon de produção — 16/10/2026 (somente leitura)

Projeto `polished-glitter-40606095`, branch `br-tiny-silence-acg489yn`, endpoint
`ep-winter-poetry-acfmrqjr` em `aws-sa-east-1`. Para o período 01/10–01/11/2026,
os totais da API de controle do projeto (`updated_at=2026-10-16T16:08:46Z`) eram
361.807 segundos de compute (~100,50 CU-h), 1.350.656 segundos ativos
(~375,18 h) e 4.538.454.075 bytes transferidos (~4,538 GB decimais). Na mesma
consulta, o endpoint estava ativo com `last_active=2026-10-16T16:08:39Z`, min
0,25/max 8 CU, pooler ligado e `suspend_timeout=300s`, ativo desde 02/10. Esse
timeout difere do default 0 do projeto, que se aplica a computes futuros; não
representa uma alteração do endpoint existente.

A leitura da branch de produção (`updated_at=2026-10-16T16:04:51Z`) registrou
361.253 segundos de compute (~100,35 CU-h), 1.348.512 segundos ativos
(~374,59 h), 4.537.878.510 bytes de transferência (~4,538 GB decimais) e
130.031.616 bytes de dados lógicos (~130,0 MB decimais). Os timestamps e os
escopos de projeto/branch diferem; não some esses acumulados como fontes
independentes. São totais agregados, sem atribuição por job ou query. As
branches de trabalho existentes descendem da produção e não são adequadas para
carga sintética. A criação de um novo projeto para esse teste foi recusada; a
carga fica pendente até existir um ambiente isolado apropriado.

As estatísticas `pg_stat_statements` cobrem 02/10/2026 16:50:26 UTC até
16/10/2026 13:31:58 UTC. Os maiores totais incluíam a leitura pública de
assentos do mapa (6.634 chamadas, 14,415 s), versões do mapa (7.475, 14,288 s),
métricas de webhooks (10.224, 7,496 s) e shell público do mapa (6.627, 6,074 s).
Isso prioriza investigação de projeções de leitura; os números são agregados de
SQL e não atribuem custo por job. As projeções dos mapas foram estreitadas no
checkout local, portanto a telemetria atual ainda não representa o código novo.
Não havia locks retidos, queries ativas acima de 30 segundos nem queries acima
de 5 minutos durante a inspeção de 16/10 às 13:31 UTC.

A amostra foi ordenada por tempo de execução e não guardou `rows/calls` ou
largura estimada dos resultados; use-a para priorizar latência/frequência, não
para ranquear egress. Os 4,479 GB transferidos são volume do projeto, não
confirmação de excedente. O Neon informou que planos pagos passaram a incluir
500 GB mensais em 01/06/2026; confira o plano e a página de billing da conta
antes de atribuir custo a esse volume
([comunicado do Neon](https://neon.com/blog/more-data-transfer-on-paid-plans)).
Mantenha CU-hours e transferência como séries separadas. A projeção mínima
reduz dados retornados pela aplicação, mas ainda não mede economia de compute.

Em uma consulta de runtime logs da Vercel de 24 horas, coletada em 16/10/2026,
o deployment de produção `dpl_HQceje4Xhy7C5Z68QmuCbv1tEhCa` registrou 4.352
eventos `job.completed` agrupados em 15 rotas. Esse valor não é execução total
confirmada: logs de conclusão podem faltar em rotas sem instrumentação ou em
execuções que falharam antes do resumo, e a consulta não separa esses casos.
Use como snapshot exploratório; não reduza schedules com base nessa diferença
frente aos 5.057 disparos/dia planejados localmente.

O Sentry retornou zero e ingestão inativa para `alusa.job.completed`,
`alusa.job.run.classification` e `alusa.job.duration` nos 14 dias consultados.
Os logs atuais de produção mostram conclusão e contagens, mas não
`workStatus`. Confirme o recebimento dessas métricas e o campo de classificação
depois da publicação antes de iniciar a comparação de 7–14 dias. A publicação
do código não confirma ingestão no Sentry: valide a telemetria de produção após
o rollout antes de usar esses sinais como base operacional.

É um snapshot pontual. Contadores de chamadas/uso desde reset não atribuem custo
exato por job. Compare disparos programados com execuções e trabalho útil nos
logs; não use o total configurado como número de tarefas concluídas.

O cron `webhook-maintenance` executa apenas verificação por padrão. A remoção
de `removeBackoff`/recuperação de fila exige uma chamada administrativa com
`autoRepair=true`, após confirmar a causa do incidente e registrar a decisão.
Isso evita que uma rotina periódica reative uma fila do Asaas enquanto a causa
da interrupção ainda está presente.

## Bootstrap do read model KYC de subconta

`process-kyc-sync` roda a cada minuto para consumir apenas jobs duráveis
`SYNC_KYC_STATUS` já vencidos; não chama o Asaas a cada disparo e não substitui
webhooks nem a reconciliação `reconcile-kyc-models` (que permanece a cada 2h).
O enqueue é feito junto à persistência da subconta no tenant (`contaId`) e
define `nextAttemptAt` para, no mínimo, 15 segundos após o provisionamento.
Cada invocação processa no máximo 10 itens com claim atômico e lease de 5
minutos. O worker tenta até 8 vezes, com backoff exponencial limitado a 15
minutos; jobs esgotados terminam em `FAILED`. A chave inclui a geração da
subconta. Uma nova tentativa de bootstrap depois de `FAILED` esgotado é um
replay explícito, auditado como `finance.kyc.bootstrap_job.requeued`; não
edite a fila diretamente no banco.

Antes de chamar o provedor, o job confirma se já existe read model sanitizado
mais recente para a geração atual. Se sim, finaliza sem GET. Caso contrário,
consulta status/documentos pontualmente e persiste somente o read model
sanitizado; `onboardingUrl` não é persistida. Mudanças posteriores continuam
dependendo principalmente de webhooks. Ao investigar atraso, verifique o
`SYNC_KYC_STATUS` pelo tenant: `PENDING`/`nextAttemptAt`, `PROCESSING`/lease,
tentativas e erro sanitizado. Falha por credencial/configuração BaaS exige
corrigir a configuração da conta; falhas transitórias permanecem elegíveis
ao backoff. O retry não deve ser substituído por consultas manuais repetidas
ao Asaas.

## Leitura operacional

Os jobs em Vercel produzem logs JSON com `event.name` como `job.started`,
`job.completed`, `job.partial_failure`, `job.needs_attention` ou `job.failed`,
além de `jobName` e `duration_ms`. Contagens de lote devem ser usadas para
separar execução vazia, trabalho real, retry e falha.
Não registrar payloads Asaas, tokens, e-mails ou mensagens de erro completas
quando não forem necessárias para a investigação.

Os 35 handlers únicos do catálogo emitem `job.started` quando a execução começa
e incluem o mesmo UUID aleatório `correlationId` em `job.completed`,
`job.partial_failure`, `job.needs_attention` ou `job.failed`. A métrica
`alusa.job.started` conta inícios com dimensão fixa `job.name`; não recebe o
UUID como dimensão. A correlação é local à invocação, não usa headers fornecidos
por quem chama e não contém tenant, payload ou segredo. Nas rotas que resolvem
escopo de tenant, uma autorização negada é registrada como
`alusa.job.request_rejected` com categoria de resultado limitada e não inicia
uma execução do job. A rota global `platform-billing-maintenance` registra
credenciais de cron inválidas na mesma série antes de retornar 401, também sem
iniciar a execução.

O `webhook-scheduler` também registra cada etapa com duração e resultado
(`success`/`error`) nas métricas `alusa.job.step.completed` e
`alusa.job.step.duration`. As contagens allowlisted de etapa aparecem em
`alusa.job.step.items`, com dimensões fixas `job.name`, `job.step` e nome do
contador. O volume `scanned` é observabilidade de volume e não participa de
`workStatus`. O resumo JSON inclui apenas nome seguro, status e duração por
etapa, contagens allowlisted e códigos de falha conhecidos, sem payload ou
mensagem bruta de erro. Falhas retornadas por drain
(`failed > 0`) e health check (`errors` ou `recoveryFailed`) também contam como
falha parcial, mesmo que a chamada resolva normalmente; eventos continuam
persistidos e elegíveis ao retry/recovery durável. Uma falha por conta no drift
check marca a etapa como falha parcial; investigue a etapa e o deployment antes
de repetir ou alterar configuração. A rota responde HTTP 500 com código estável
`SCHEDULER_PARTIAL_FAILURE` quando `hasErrors` é verdadeiro. O cron não é tratado
como mecanismo de retry: o trabalho persistido permanece elegível ao próximo
ciclo do scheduler. Alertas devem considerar o status HTTP e as métricas/logs
por etapa; não presumir que Vercel repetirá a invocação.

Os 36 schedules do catálogo apontam para 35 route handlers únicos, que
registram conclusão por meio de `logJobResult`; `pnpm audit:job-contracts`
bloqueia a remoção desse registro de uma rota catalogada. A telemetria usa
`alusa.job.completed` e
`alusa.job.duration` com dimensões de nome seguro do job e resultado, e
`alusa.job.items` para contagens allowlisted. Os logs `job.completed`,
`job.partial_failure` e `job.needs_attention` incluem duração e somente
contagens/campos explicitamente permitidos. Esses dados ajudam a separar uma
invocação vazia de uma execução com trabalho, retry ou falha; não revelam custo
exato de compute por job.

Cada conclusão também inclui `workStatus=worked|empty|unknown` e incrementa a
métrica `alusa.job.run.classification` com dimensões fixas `job.name` e
`result`. A classificação mede trabalho elegível encontrado ou tratado: não
conta enumeração de tenants nem consultas SQL. `unknown` é o padrão quando os
resultados atuais não distinguem execução vazia de trabalho tentado; falha
parcial pode coexistir com `worked` ou `unknown`.

As métricas existentes `finance.webhook.backlog`, `finance.webhook.pending`,
`finance.webhook.processing`, `finance.webhook.errored`,
`finance.webhook.exhausted`, `finance.webhook.high_retry_backlog`,
`finance.webhook.stuck_processing` e `finance.webhook.oldest_pending_age`
descrevem estado agregado da fila de webhooks; as métricas de lag da fila
também pertencem ao pipeline global. Elas não são atribuídas a cada job pelo
novo contexto de correlação. A instrumentação por job registra duração,
resultado e contagens allowlisted, mas não cria métricas de `queueDepth` ou lag
por job. A ingestão dessas métricas e logs no Sentry/produção precisa ser
confirmada após o rollout.

Estado da classificação baseada nos resultados disponíveis no código:

| Rotas classificadas | Sinal usado |
| --- | --- |
| `platform-billing-maintenance` | webhooks processados/notificações reclamadas, alterações de plano, trials ou grace periods verificados, ou issues de billing encontradas pela reconciliação classificam `worked`; enumeração de contas sem issue não conta como trabalho |
| `provision-asaas-subaccounts` | itens processados classificam `worked`; sem processamento e sem falha/recuperação pendente confirma `empty`; falha ou recuperação pendente sem processamento fica `unknown` |
| `retry-enrollment-billing-provision` | tentativas nas outboxes de enrollment/family/individual |
| `webhook-maintenance` | drift ou recuperação concluída; erros sem trabalho concluído resultam em `unknown` |
| `archive-finance-webhooks` | itens selecionados para arquivamento |
| `reconcile-stale-invoices` | invoices/cobranças/configurações escaneadas ficam visíveis como volume; `worked` exige sync ou recovery confirmado; zero seleções e zero falhas permite `empty`; seleção sem efeito confirmado fica `unknown` |
| `reconcile-open-transfers` | transferências oficiais retornadas para reconciliação |
| `reconcile-finance-accounts` | modo webhook usa recursos financeiros efetivamente verificados; modo por conta usa reconciliações concluídas como `worked`, lote vazio como `empty`, throttle/seleção sem reconciliação como `unknown` |
| `reconcile-kyc-models` | inconsistências encontradas/reconciliadas; `checkedAccounts` é apenas enumeração e não conta como trabalho; lote truncado em 100 ou erro fica `unknown` |
| `apply-asaas-notification-preferences` | itens enfileirados/processados/falhos confirmados classificam `worked`; apenas `scanned` fica `unknown`; sem seleção nem falha confirma `empty` |
| `process-asaas-notification-sync` | `processed` confirmado classifica `worked`; `scanned` é volume; zero seleção/falhas permite `empty`; tentativas sem efeito ficam `unknown` |
| `reconcile-asaas-customers` | snapshots/endereço escaneados ficam visíveis como volume; updates/deletes/sync confirmados classificam `worked`; os demais casos ficam `unknown`, pois endereço pode ignorar contas sem credenciais sem reportar a omissão |
| `rebuild-billing-read-models` | projeções/refrescos concluídos; falha ou credenciais ausentes sem conclusão resulta em `unknown` |
| `rebuild-finance-aggregates` | transações escaneadas |
| `process-ticket-email-outbox` | itens reclamados/tentados na outbox |
| `events-inspect-financial-inconsistencies` | achados de inconsistência; `inspected` é varredura ampla e não conta como trabalho; skip por lock resulta em `unknown` |
| `process-pending-inbox-notifications` | itens tentados na outbox |
| `archive-low-value-notifications` | notificações arquivadas |
| `process-overdue-billing-notifications` | notificações emitidas; itens ignorados sem emissão resultam em `unknown` |
| `notify-contracts-expiring` | notificações emitidas classificam `worked`; avaliação sem emissão fica `unknown` porque parte dos contratos está fora das janelas 7/3/1 dia; sem avaliação confirma `empty` |
| `reconcile-matricula-cancellations` | operações de cancelamento processadas |
| `rematriculas/run` | contratos, acordos, outbox ou ativações materializados/processados |
| `cleanup-upload-reservations` | exclusões de objetos e updates confirmados de reservas classificam `worked`; reservas apenas selecionadas ficam `unknown`; consulta sem reservas e sem falhas confirma `empty` |
| `reconcile-finance-webhooks` | checagens de pagamentos/assinaturas/parcelas efetivamente selecionadas; lock, execução parcial/falha ou alvo sem confirmação permanece `unknown` |
| `reconcile-payment-commands` | contagens `commandsScanned`, `staleCommandsScanned`, `outboundOperationsScanned` e `enrollmentCreationsInspected` mostram volume; sync de comando, marcação stale ou recovery outbound confirmados classificam `worked`; scan sem efeito fica `unknown`; nenhuma seleção classifica `empty` |
| `reconcile-fiscal-settings` | sincronização fiscal concluída; falha sem sucesso e escopo direcionado sem seleção ficam `unknown` |
| `evaluate-financial-operational-health` | alertas não-INFO avaliados, abertos ou resolvidos classificam `worked`; sem alerta no escopo global é `empty`; avaliação direcionada por `contaId` sem alerta confirmado fica `unknown` |
| `events-expire-reservations`, `events-reconcile-orders`, `events-reconcile-refunds`, `events-fulfill-tickets` | `processed` de candidatos elegíveis; lock/error sem item processado fica `unknown` |
| `encerrar-contratos` | contratos elegíveis processados ou encerramentos familiares materializados; falha/escopo direcionado sem fechamento fica `unknown` |
| `expire-contract-links` | links realmente expirados; no cron global, lista filtrada vazia significa `empty`; escopo direcionado sem atualização fica `unknown` |
| `retry-enrollment-billing-provision` | tentativas reais nas outboxes ou retries individuais classificam `worked`; apenas scan ou dry-run sem tentativa fica `unknown`; sem candidatos confirma `empty` |
| `whatsapp` | itens reclamados pelas filas; falha sem claim e fila pausada ficam `unknown` |
| `webhook-scheduler` | contadores de candidatos/ações por etapa (incluindo `eligible` no side-effect outbox); não usa `scanned` ou enumeração como trabalho; `empty` exige evidência completa dos estágios normais, e health check sem confirmação suficiente, lock, falha ou detalhe incompleto fica `unknown` |

Os logs de `reconcile-payment-commands` registram contagens agregadas por etapa
(`commandsScanned`, `staleCommandsScanned`, `staleCommandsMarked`, `outboundOperationsScanned`,
`enrollmentCreationsInspected`); `whatsapp` registra claims, envios/processados,
retries e dead letters por fila; `encerrar-contratos` registra
`eligibleClosures`. Esses nomes aparecem em `alusa.job.items` como resultado e
dimensão de contador, sem tenant ou identificador de registro.

Na rota `reconcile-open-transfers`, `fetched > 0` representa transferências
obtidas do provedor e classificadas para reconciliação; contas candidatas sem
nenhum registro retornado ficam `unknown`, pois não confirmam nem reconciliação
nem ausência global de trabalho. A lista global de contas vazia confirma
`empty`.

As rotas acima derivam o estado de contagens já produzidas pelos serviços e não
fazem consultas adicionais para telemetria. Detalhes incompletos, lock skips,
falhas sem item processado e execuções de conta direcionada sem seleção
continuam `unknown`; não são contabilizados como vazio.

No job `rematriculas/run`, `outcome=needs_attention` indica que uma ativação foi
bloqueada por uma pendência de domínio (por exemplo, sobreposição ou
inconsistência financeira). A execução retorna HTTP 200 e `success: false` com
esse outcome para tornar a pendência visível; isso não é classificado como
falha técnica nem como conclusão integral. `partial_failure` tem precedência
quando também houve falha de conta, contrato ou outbox. Acompanhe
`job.needs_attention` separadamente de `job.partial_failure`; investigar a
pendência de domínio não exige retry técnico automático.

Use a telemetria da janela de observação para comparar por job quantidade de
invocações, duração, contagens processadas/ignoradas e resultado. Antes de
ajustar frequência, confirme em produção o backlog e o SLA de webhook e
reconciliação; a configuração local e os contadores agregados do Neon não
substituem essa evidência.

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

## Teste de carga controlado

Na inspeção de 16/10/2026 não foi identificada uma branch Neon designada para
staging ou carga sintética. A criação de um novo projeto Neon para esse teste
foi recusada explicitamente; portanto, não há ambiente Neon isolado disponível
nesta onda e o teste de carga continua pendente. Não execute carga na branch de
produção nem em branches de trabalho que tenham outra finalidade. Se um staging
existente for proposto, confirme antes que ele é comprovadamente isolado e não
derivado de produção. Antes do teste, registre o projeto, branch, endpoint e
banco alvo; use dados sintéticos, concorrência e duração limitadas, métricas de
parada e um procedimento de limpeza. Reconfirme que as URLs de runtime e
`DIRECT_URL` apontam somente para esse ambiente isolado. Compare backlog,
latência, erros e compute durante a carga; não use apenas throughput como
critério de aprovação.

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

## Correlação e custos reportados — 16/10/2026

Os 35 handlers únicos do catálogo emitem `job.started` com UUID aleatório e
repetem o mesmo `correlationId` em `job.completed`, `job.partial_failure`,
`job.needs_attention` ou `job.failed`. `alusa.job.started` conta invocações com
dimensão fixa `job.name`; o UUID não vira dimensão de métrica. Não são usados
headers enviados pelo chamador e a correlação não inclui tenant, payload ou
segredos. Nas rotas que resolvem escopo de tenant e na rota global
`platform-billing-maintenance`, uma autorização negada gera
`alusa.job.request_rejected`, sem `job.started` nem evento terminal. A ingestão
dessa série após publicação ainda precisa ser confirmada.
Essa instrumentação não faz queries de observabilidade, não atribui os gauges
globais `finance.webhook.*` a um job específico e não mede `queueDepth`, lag
por job ou `dbQueries`.

O usuário informou para o ciclo de billing: US$ 10,29 total (US$ 10,27 compute,
US$ 0,02 storage), 96,91 CU-h, ~0,13 GB de storage e ~4,46 GB de transferência.
Este snapshot de ciclo é distinto do snapshot de uso da API do Neon registrado
acima; as janelas podem ser diferentes. O alerta de US$ 10 notifica, mas não é
um hard cap de cobrança.

O scheduler de webhooks roda a cada 2 minutos e realiza lock/persistência no
Postgres. Com `suspend_timeout=300s`, esse tráfego pode reiniciar o timer de
suspensão e manter o compute ativo se os disparos ocorrerem como configurado.
Considere isso uma hipótese causal forte, não custo atribuído ao job. A média
96,91 CU-h / 373,27 h active ≈ 0,26 CU sugere consumo próximo ao mínimo de
0,25 CU; confirme a janela no billing e no autoscaling history do endpoint.
Não ajuste o schedule sem validar SLA e telemetria comparável.
