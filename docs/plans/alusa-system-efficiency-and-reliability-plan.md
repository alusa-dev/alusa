# Plano de eficiência, confiabilidade e organização sistêmica da Alusa

**Status:** implementação local em execução controlada; mudanças de produção dependem de rollout e observação operacional
**Data de atualização:** 19/10/2026
**Escopo:** workspace, API, jobs, filas, PostgreSQL/Neon, Redis, integrações, financeiro, webhooks, multi-tenant, testes, observabilidade e operação.

## 1. Objetivo

Reduzir o consumo desnecessário de compute e quota, aumentar a previsibilidade operacional e manter a Alusa organizada sem comprometer:

- isolamento entre `Conta`s;
- matrícula, contrato e cobrança;
- idempotência e reconciliação financeira;
- webhooks como fonte de mudança de estado;
- auditoria e histórico;
- compatibilidade dos clientes web, admin e mobile;
- capacidade de evolução futura.

O plano prioriza mudanças pequenas, mensuráveis, reversíveis e compatíveis com a arquitetura atual. Não propõe introduzir uma plataforma de filas externa antes de provar a necessidade por métricas.

## 1.1 Registro histórico de execução (16/10/2026)

O registro abaixo contém um snapshot histórico do trabalho local anterior; seus
resultados não são uma validação desta execução nem evidência de produção.
Na onda registrada naquele snapshot foi feito o seguinte:

- recontagem por parsing JSON dos arrays `crons` (não por linhas de arquivo):
  `apps/web/vercel.json` tem 36 entries e o `vercel.json` raiz também tem 36;
  são manifests de deployment e não devem ser somados como 72 jobs distintos;
- para a configuração atual do app, a expansão dos 36 schedules resulta em
  5.057 disparos planejados/dia: 4.932 por schedules intervalares, 120 por
  cinco horários fixos por hora e 5 por cinco horários diários. Isso é somente
  frequência configurada, não execução observada nem trabalho útil;
- o `webhook-scheduler` registra duração e resultado por etapa em logs/métricas,
  e falhas individuais no drift check deixam de parecer sucesso completo;
- a rota responde `500` com código estável em falha parcial; a fila persistida
  continua sendo recuperada no próximo ciclo do scheduler, sem depender de
  retry automático do cron. Alertas devem observar telemetria e status HTTP;
- os 36 schedules do catálogo apontam para 35 route handlers únicos, e todos
  registram resumo de conclusão; `pnpm audit:job-contracts` exige esse registro
  para cada rota agendada. O helper limita atributos a contagens numéricas e
  campos extras allowlisted, além de emitir métricas de quantidade e duração
  por job;
- `rematriculas/run` diferencia execução concluída, falha parcial e
  `needs_attention` quando ativações ficam bloqueadas por pendências de domínio.
  Essa condição é registrada separadamente de erro técnico, sem alterar o HTTP
  200 nem incluir IDs ou mensagens privadas na telemetria.
- a auditoria dos 35 route handlers encontrou cinco classificações que podiam
  tratar varredura/avaliação sem efeito como trabalho concluído; elas agora
  retornam `unknown` até haver claim, tentativa, notificação ou fetch confirmado.
- projeções Prisma do mapa público e da visão da equipe foram reduzidas aos
  campos consumidos pelo mapper/fluxo de reserva, preservando filtros tenant,
  visibilidade pública e locks de reserva.

## 1.2 Atualização local para a publicação de 19/10/2026

- Os manifests do app e da raiz contêm 37 schedules, que correspondem a 36
  route handlers únicos; `pnpm validate:cron-config` e
  `pnpm audit:job-contracts` confirmaram o alinhamento.
- A configuração atual planeja 6.497 disparos por dia. É uma contagem de
  schedules, não uma medição de execuções efetivas, trabalho útil ou custo.
- O polling `process-kyc-sync` permanece a cada minuto. O SLA de frescor do
  read model KYC não está definido; nenhuma redução de frequência foi incluída
  nesta publicação.
- O schedule dedicado de email permanece ativo como via de drenagem sob
  backlog; não foi removido com base apenas na sobreposição aparente com o
  scheduler geral.
- As melhorias de observabilidade e confiabilidade ainda dependem de rollout e
  observação. O aceite de eficiência continua condicionado a medir consumo no
  Neon, backlog e frescor KYC após a publicação.

Foram implementados e validados localmente em snapshots anteriores:

- observabilidade JSON para jobs críticos, sem serializar payloads ou segredos;
- catálogo de cron jobs com owner, criticidade, retry e grupo de exclusão;
- auditoria automática do catálogo e dos contratos dos route handlers de jobs;
- `maxDuration` explícito nos jobs que ainda não o declaravam;
- sequência única de drain para webhook queue e side-effect outbox;
- opção explícita para worker/scheduler não processarem a mesma fila duas vezes;
- seleção mínima e escopo tenant explícito no processador de sincronização de notificações;
- consolidação das métricas da fila de webhooks em uma agregação SQL tenant-scoped, reduzindo sete leituras de contagem para uma por execução;
- consolidação das métricas operacionais financeiras em uma ida ao banco por conta;
- coalescência no cliente para impedir `sync-asaas` concorrente da lista e do detalhe;
- testes de coalescência, outbox, worker e métricas, além dos gates de segurança e arquitetura.

O aceite de produção continua exigindo janela de observação, comparação com a
baseline, confirmação de aliases/deployment e validação E2E Conta A/Conta B.
Isso não é substituído por um build verde e não deve ser marcado como concluído
sem evidência do ambiente publicado.

### Estado das fases nesta atualização

| Fase | Estado | Evidência e pendência para aceite |
|---|---|---|
| 0 — Baseline e ownership | Parcial | Catálogo e manifests conferidos (`37` schedules, `36` rotas únicas); há snapshots de Vercel, Neon e p95 de spans HTTP de jobs no Sentry. Os `count()` do Sentry são spans observados, não execuções exatas, e não medem trabalho útil, atraso, quota ou custo atribuível por job/tenant. Ainda falta baseline comparável de trabalho útil, atrasos e quota por janela. |
| 1 — Observabilidade | Parcial | Os handlers catalogados registram início/conclusão, duração, contagens seguras e classificação `workStatus`; o auditor agora exige `workStatus` em cada rota agendada. O snapshot de spans HTTP no Sentry fornece p95 de duração por rota, mas seus `count()` não equivalem a execuções exatas e a métrica `alusa.job.completed` ainda não tem amostras históricas porque esta instrumentação não foi publicada. O aceite continua pendente de confirmação de ingestão e comparação pós-publicação. Separadamente, a telemetria de webhooks fornece gauges agregados de backlog/estados e idade da fila via `getWebhookQueueMetrics`, além de distribuições do recebimento ao claim e à conclusão por categoria de evento. Essa cobertura é específica ao fluxo de webhooks: não atribui backlog/lag a jobs ou tenants, não mede `dbQueries` nem custo por job. |
| 2 — Polling e timers | Pendente | Nenhuma frequência foi reduzida nesta onda. Decisões dependem da janela comparável e da confirmação dos SLAs de webhook e reconciliação. |
| 3 — Outbox e deduplicação | Parcial | A [matriz de outboxes financeiros e de webhook](../architecture/financial-outbox-coverage.md) registra, por modelo, produtor/fronteira transacional, dedupe, claim, retry e replay/DLQ onde comprovados; o [runbook de recuperação](../runbooks/financial-outbox-recovery.md) mapeia ações existentes e triagem somente leitura. Integrações PostgreSQL local cobrem retry de webhook/side-effect, claim único de rematrícula, disputa de enqueue/claim de `MatriculaBillingOutbox` e fencing de lease para `AsaasNotificationPreferenceOutbox` e `AsaasNotificationSyncOutbox`, preservando Conta B. O teste novo de matrícula comprovou dedupe concorrente intra-Conta A, um único claim/provisionamento mockado entre dois workers e Conta B ainda PENDING, sem chamar Asaas. O fencing protege o estado/finalização no banco, mas não cancela PUT Asaas já iniciado; se um PUT de preferência termina após perder claim, o worker agora re-enfileira a preferência atual da escola, que prevalece sobre canais da cobrança (fallback apenas sem preferências salvas). Mudança da régua durante sync disparado por cobrança também re-enfileira a intenção corrente. O worker antigo continua incapaz de finalizar a linha nova. Testes usam providers mockados; resultado local não é evidência Neon, staging ou produção. Para divergências persistentes, comparar remoto/local e escalar ao owner. A UI foi alinhada para comunicar que prevalecem as preferências atuais da escola. Owners seguem como bounded contexts e replay por registro não existe para todos os fluxos; falta prova integrada uniforme para os oito outboxes. |
| 4 — Concorrência por tenant | Parcial | Há preenchimento de lote tenant-fair em processamento de webhooks e limites existentes em alguns workers. Falta medir justiça, contenção e impacto entre tenants sob carga representativa. |
| 5 — Queries e Neon | Parcial | As projeções locais menores para mapa de eventos são sustentadas por volume SQL de linhas retornadas e overfetch confirmado no código. A projeção observada no Neon antecede essa mudança local ainda sem rollout confirmado; linhas são apenas proxy de volume, não egress medido nem custo atribuível por query. Não houve migration de índice. Falta comparação pós-publicação de linhas, transferência e p95; compute-hours permanecem uma métrica separada. |
| 6 — API e frontend | Parcial | Fallbacks automáticos e ações explícitas agora emitem métricas de contagem e duração com dimensão de origem/resultado allowlisted. O teste unitário local de `POST /api/cobrancas/[id]/sync-asaas` passou 3/3 e confirma que a busca usa `contaId` autenticado, que as chaves de rate limit contêm somente tenant/usuário/cobrança autenticados e que `invalidateChargeResourceCache` recebe tenant e cobrança autenticados apenas após sucesso (sem invalidação em `skipped`/falha); `pnpm --filter @alusa/web typecheck` também passou. Isso verifica o contrato no checkout, não o comportamento pós-rollout: ainda falta confirmar ingestão e comparar volume/sobreposição após publicação, além de validar cache/invalidação tenant-scoped em produção. |
| 7 — Organização do workspace | Parcial | Nesta worktree passaram `workspace:check`, validação da configuração cron, auditorias de contrato de jobs, fronteiras de rotas, contrato HTTP, segurança e `pnpm typecheck` completo (16 pacotes). `pnpm lint` terminou com código 0, sem erros e com 898 avisos. `pnpm build:web` e a repetição `pnpm exec turbo run build --filter=@alusa/web --no-cache` terminaram com código 0: 13/13 tarefas, TypeScript e 247/247 páginas; com o cache do Turbo desligado, o webpack ainda registrou `ENOSPC` ao gravar seu cache durante a pressão de disco. O `.next` gerado (2 GB e ignorado pelo Git) foi removido após inspeção para liberar espaço. A validação em clone limpo com instalação congelada, Prisma generate, gates e build do comando Vercel está registrada abaixo; ela não é evidência de deployment. Revisões de arquitetura e adversariais da cobertura de outbox foram concluídas; o aceite operacional continua dependendo das evidências listadas nas fases 0–6 e 8. |
| 8 — Testes e operação | Parcial | Nesta worktree passaram os testes focados: integração scheduler/outbox em PostgreSQL local `alusa_test` (1 caso selecionado; o arquivo completo havia passado 3/3 antes da extensão de outbox), nova integração do claim da rematrícula contra PostgreSQL local (1/1, sem truncar tabelas), rota de rematrículas (4/4), lock (5/5), quatro suítes unitárias focadas de outbox financeiro (57/57 com setup Vitest isolado sem conexão a DB) e `renewal-outbox.service.test.ts` (4/4, incluindo backoff progressivo, elegibilidade temporal, Conta A/B e corrida stateful entre workers). Antes das correções focadas finais de arquitetura, o Finance suite completo passou nesta worktree: 263 arquivos / 2.195 testes, com 1 arquivo e 1 teste skipped, em 236s usando o banco PostgreSQL local descartável `alusa_test_claim_20261016`; as 352 migrations estavam aplicadas e o schema estava atualizado. Esse resultado é evidência local anterior à correção final do pacote Finance, não do suite completo do monorepo, nem de Neon, staging ou produção. Após as correções de arquitetura passaram quatro suítes de rotas focadas (6/6 testes), a suíte de falha de `cleanup-upload-reservations` (2/2), a suíte do serviço de outbox de notificação Finance (7/7), e os typechecks de `@alusa/web` e `@alusa/finance`; `git diff --check` passou e o gate final de arquitetura foi **APPROVED**. A execução consolidada mais recente de `pnpm test` terminou com exit 0; o log `/tmp/alusa-efficiency-root-test-20261016.log` registra 438 arquivos e 2.070 testes aprovados. Esses totais pertencem ao comando raiz e não são uma soma de contagens por pacote. Em uma execução Finance anterior, o resultado conhecido foi 262 arquivos / 2.193 testes aprovados, com 2 arquivos / 3 testes skipped; essa contagem não é atribuída ao comando raiz atual. Também passaram as três integrações PostgreSQL direcionadas: `packages/finance/src/services/__tests__/notification-outbox-claim.integration.test.ts` (2/2), `apps/web/tests/integration/enrollments/renewal-outbox.claim.integration.test.ts` (1/1) e `apps/web/tests/integration/platform-billing-webhook-worker.integration.test.ts` (1/1). Elas usaram o banco descartável local `alusa_test_efficiency_20261016_03` em loopback; as 352 migrations estavam aplicadas e `prisma migrate status` informou schema atualizado. Depois, passou `apps/web/tests/integration/enrollments/matricula-billing-outbox-race.integration.test.ts` (1/1) no PostgreSQL descartável `alusa_test_matricula_outbox_20261016_01` em loopback, com 352 migrations aplicadas: enqueue deduplicado concorrente na Conta A, claim/provisionamento mockado único e Conta B preservada. O banco foi removido após o teste. Esses resultados não são evidência Neon, staging ou produção. Os testes unitários de outbox com Prisma mock não são integração com banco real. A integração das notificações mantém os provedores externos mockados: comprova claim/finalização no banco, mas não uma requisição Asaas em voo que termine após recuperação stale. Esse comportamento pode deixar Asaas divergente mesmo com linha `DONE`; compare estado remoto/local e escale ao owner. A precedência definida por produto é: preferências salvas da escola prevalecem; canais guardados na cobrança são fallback somente quando ainda não há preferências da Conta. A UI foi alinhada a essa regra. Não há prova uniforme dos oito fluxos de outbox. Permanecem teste de carga em Neon/staging isolado, cobertura A/B para todos os jobs/read models e métricas/aceite pós-publicação. |

Não foi identificada uma branch Neon dedicada a carga sintética. O usuário
recusou a criação de um novo projeto Neon, então nenhum projeto foi criado e a
carga continua pendente. As branches existentes são produção ou branches de
trabalho derivadas de `parent-data`; nenhuma foi usada para carga. Um staging
existente só pode ser considerado após comprovar isolamento, uso de dados
sintéticos e limites de custo; não direcionar carga a produção ou branches
derivadas dela.

**Evidência desta atualização:** inspeção do checkout local e snapshot de leitura
do Neon em 16/10/2026. Os 36 entries e 5.057 disparos/dia descrevem configuração
planejada, não execuções confirmadas ou trabalho útil. A janela de uso do Neon
é agregada e não permite atribuir custo exato a cada job.

**Revalidação externa somente leitura (16/10/2026, 16:30 UTC):** o Neon ainda
lista somente a branch protegida `production`, duas branches `ready` derivadas
dela (`codex-rls-policy-validation` e `codex-release-migrations-20261009`) e
uma branch antiga arquivada; não há branch isolada apta a receber carga. A
última deployment production de `alusa-web` que o Vercel retornou está `READY`
no SHA base `70d1578ccb6c72b0cb1e0ccac0e0bbb4bf509e32`; as mudanças desta
worktree não estão publicadas. As buscas dos últimos 14 dias no Sentry não
encontraram `alusa.job.completed` nem
`alusa.finance.charge_sync.request` ([explorar métricas no Sentry](https://alusa.sentry.io/explore/metrics/?statsPeriod=14d)). Isso
confirma que ainda não existe amostra pós-publicação para aceitar as fases 1,
5 e 6.

A instrumentação de conclusão cobre os 35 route handlers únicos referenciados
pelos 36 schedules do catálogo neste checkout. Ela permite comparar
invocações, duração, contagens agregadas e resultados (`success`,
`partial_failure` e, no fluxo de rematrícula, `needs_attention`). Isso cria uma
baseline observável; ainda não mede economia, não atribui custo Neon por job e
não autoriza reduzir frequência de jobs críticos antes de uma janela de
produção comparável.

Na atualização de 16/10/2026, os 35 handlers registram `job.started` com UUID
aleatório de correlação, repetido no evento terminal da mesma invocação.
`alusa.job.started` mede início por nome fixo de job; UUID não é dimensão de
métrica. Essa telemetria de jobs não consulta o banco para obter filas, não mede
`dbQueries` nem atribui custo por job ou tenant. Separadamente, `getWebhookQueueMetrics`
reutiliza uma query agregada existente para emitir gauges globais de backlog,
contagens por status, retry/stuck e idade do item pendente mais antigo; eventos
de webhook também registram distribuições de lag do recebimento ao claim e à
conclusão. Esses sinais permanecem específicos aos webhooks e não medem
`queueDepth`/lag por job. Nas rotas que resolvem escopo de tenant, uma autorização
negada emite `alusa.job.request_rejected` com categoria de resultado limitada e
não inicia a execução do job; a rota global `platform-billing-maintenance` usa a
mesma série para credenciais inválidas antes de iniciar. A ingestão
pós-publicação dessas séries ainda precisa ser confirmada no Sentry/backend de
métricas.

### Snapshot informado pelo usuário — ciclo de billing em 16/10/2026

O usuário informou os seguintes valores do ciclo: US$ 10,29 no total, US$ 10,27
de compute, US$ 0,02 de storage, 96,91 CU-h, aproximadamente 0,13 GB de storage
e 4,46 GB de transferência. Esta é uma evidência fornecida pelo usuário e está
separada do snapshot de uso obtido pela API do Neon acima; as janelas podem
diferir e precisam ser reconciliadas com o histórico de autoscaling antes de
comparação. O alerta configurado em US$ 10 é um limite de notificação, não um
teto de cobrança.

Com o cron de `webhook-scheduler` a cada 2 minutos e `suspend_timeout=300s`, a
atividade periódica de lock/persistência no Postgres pode reiniciar o timer de
suspensão e manter o compute ativo, caso as execuções ocorram como configurado.
É uma hipótese causal forte, não medição de custo por job. A média aproximada
`96,91 CU-h / 373,27 h active ≈ 0,26 CU` fica próxima do mínimo configurado de
0,25 CU; confirme janelas de billing e autoscaling history antes de atribuir a
atividade ao scheduler. Não reduzir frequência sem evidência de SLA e
telemetria comparável.

### Auditoria F2 — COUNT e polling agendado (16/10/2026)

Revisão estática dos caminhos de jobs catalogados, das rotas e dos serviços
chamados, procurando `count()` usado só para existência e leituras de polling
repetidas. **Não foi encontrado um `COUNT(*)` em caminho agendado que seja
inequivocamente substituível por um teste de existência sem mudar a semântica.**
Os usos examinados têm consumidores explícitos:

- `getWebhookQueueMetrics` agrega status, retry, stuck-processing e idade da
  fila em uma única query SQL para alimentar gauges e SLOs
  (`packages/finance/src/webhooks/webhook-reconciliation.service.ts`); são
  medidas operacionais reais, não um booleano de existência.
- A entrega do efeito de ingresso compara tickets `VALID`/`USED` à quantidade
  da venda/pedido e ao `ticketCount` persistido antes de enviar
  (`packages/finance/src/webhooks/finance-side-effect-outbox.service.ts`). A
  igualdade protege a integridade da entrega; não substituir por `some`/`take:1`.
- A reconciliação de parcelas compara `Charge` local com `remotePayments.totalCount`
  para detectar divergência (`packages/finance/src/webhooks/webhook-reconciliation.service.ts`).
- Os `count()` de lease em `billing-agreements` verificam se **todos** os IDs
  ainda pertencem ao token ativo antes de permitir mutação
  (`packages/finance/src/billing-agreements/runtime.ts`,
  `mutation-lease.ts` e `scheduled-processor.ts`); são fencing/concurrency
  guards, não leitura descartável. A rota
  `process-billing-agreement-lifecycle` que chama esse processor não está nos
  manifests de cron nem no catálogo, portanto não foi contada como schedule
  ativa nesta auditoria.
- Contagens nas APIs de listagem/diagnóstico têm paginação ou representam
  backlog, rejeições e processados por janela. Não foram tratadas como queries
  de existência no cron.

Foi confirmado um overlap de polling que merece medida, sem evidência suficiente
para mudança de agenda: `webhook-scheduler` drena a `FinanceWebhookSideEffectOutbox`
geral a cada 2 minutos e `process-ticket-email-outbox` seleciona o tipo
`EVENT_PUBLIC_ORDER_TICKET_EMAIL` a cada 5 minutos. O primeiro pode consumir
itens que também pertencem ao segundo; claims/estado persistidos preservam o
processamento durável, mas as duas rotas podem repetir leituras/varreduras do
mesmo conjunto elegível. Compare `scanned`, `eligible`, `claimed`, falhas e
efeitos entregues por etapa após ingestão de telemetria; o snapshot local não
quantifica o custo dessa sobreposição nem o SLA de entrega do e-mail.

Outras leituras parecidas não foram classificadas como duplicadas semânticas:
`process-overdue-billing-notifications` consulta `Cobranca` acadêmica e `Charge`
avulsa em sequência, usando o limite restante, pois são modelos distintos; e
`reconcile-payment-commands` percorre tipos diferentes de
`AsaasIntegrationJob` (comandos PAYMENT, operações CREATE e criações de
matrícula). Não foi feita otimização de código nesta auditoria. Uma substituição
de claim/contagem por `findFirst`, redução de janela ou consolidação de polling
exige medição de carga/contenda e SLA explícito antes de alterar serviço ou
frequência.

### Snapshot de runtime Vercel — 16/10/2026 (somente leitura)

No deployment de produção `dpl_HQceje4Xhy7C5Z68QmuCbv1tEhCa`, associado ao SHA
`70d1578ccb6c72b0cb1e0ccac0e0bbb4bf509e32`, os logs agrupados por rota
registraram 4.352 eventos `job.completed` em 24 horas, distribuídos por 15
rotas. A configuração local estima 5.057 disparos planejados/dia. A diferença
não identifica sozinha invocações ausentes: pode incluir falhas, rotas sem
resumo de conclusão, cobertura do log ou diferenças entre agenda local e ativa.
Uma amostra recente contém várias execuções de filas sem itens e durações de
milissegundos, mas não basta para estimar a proporção vazia de cada job.

Os logs consultados no Vercel mostram eventos de conclusão, mas os exemplos
disponíveis não incluem `workStatus`. A consulta agregada de logs para 14 dias
excedeu o limite do provedor; a janela confiável observada foi de 24 horas.
Na consulta anterior do runtime, não foi possível consultar métricas no Sentry:
as credenciais `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT` não estavam
disponíveis naquele ambiente. O snapshot abaixo é uma consulta read-only
posterior e não substitui a confirmação de ingestão pós-publicação.

### Snapshot Sentry de spans HTTP de jobs — 16/10/2026 (somente leitura)

No projeto `alusa/javascript-nextjs`, ambiente `production`, janela móvel de
14 dias, foram observadas 32 transações HTTP `/api/jobs/` com spans. Maiores
p95 de duração e contagens observadas:

| Rota | p95 de duração | `count()` observado |
|---|---:|---:|
| `GET /api/jobs/webhook-maintenance` | 2.039 ms | 5.780 |
| `GET /api/jobs/platform-billing-maintenance` | 1.762 ms | 27.720 |
| `GET /api/jobs/reconcile-payment-commands` | 1.263 ms | 11.080 |
| `GET /api/jobs/reconcile-asaas-customers` | 121 ms | 76.540 |

Os `count()` representam spans observados no dataset Sentry: não garantem
execuções exatas nem cobrem dispatches não amostrados. Não devem ser comparados
como equivalentes à configuração de cron, trabalho útil, consultas ao banco,
compute ou custo por job/tenant. A consulta de `alusa.job.completed` retornou
contagem zero no mesmo intervalo; como a instrumentação deste checkout ainda
não foi publicada, não há amostras históricas disponíveis para essa métrica,
sem evidência de falha de ingestão pós-rollout.

Referência: [dashboard dos traces de jobs no Sentry](https://alusa.sentry.io/explore/traces/?query=has%3Ahttp.method+AND+transaction%3A%22*%2Fapi%2Fjobs%2F*%22+AND+environment%3Aproduction&project=4511312339468288&aggregateField=%7B%22groupBy%22%3A%22transaction%22%7D&aggregateField=%7B%22yAxes%22%3A%5B%22p95%28span.duration%29%22%2C%22count%28%29%22%5D%7D&mode=aggregate&sort=-p95%28span.duration%29&statsPeriod=14d&table=span).

### Snapshot operacional Neon — 16/10/2026 (somente leitura)

| Campo | Valor observado |
|---|---|
| Projeto | `polished-glitter-40606095` |
| Branch de produção | `br-tiny-silence-acg489yn` |
| Banco de produção | `alusa_prod` |
| Endpoint de produção | `ep-winter-poetry-acfmrqjr` (`aws-sa-east-1`) |
| Período de uso do projeto | 01/10/2026–01/11/2026 |
| Compute consumido pelo projeto (API Neon, `updated_at=2026-10-16T16:08:46Z`) | 361.807 segundos (~100,50 CU-h) |
| Tempo ativo do projeto | 1.350.656 segundos (~375,18 horas) |
| Data transfer | 4.538.454.075 bytes (~4,538 GB decimais) |
| Dados lógicos da branch de produção (API, `updated_at=2026-10-16T16:04:51Z`) | 130.031.616 bytes (~130,0 MB) |
| Default de endpoints do projeto | min 0,25 / max 8 CU; `suspend_timeout_seconds=0` |
| Endpoint de produção existente | min 0,25 / max 8 CU; pooler ligado; `suspend_timeout=300s`; `current_state=active` |
| Estado do endpoint | `current_state=active`; `started_at=2026-10-02T16:50:27Z`; `last_active=2026-10-16T16:08:39Z` |
| Contadores mais recentes da branch de produção (API, `updated_at=2026-10-16T16:04:51Z`) | 1.348.512 segundos ativos (~374,59 h); 361.253 segundos de compute (~100,35 CU-h); 4.537.878.510 bytes transferidos (~4,538 GB decimais); 130.031.616 bytes de dados lógicos (~130,0 MB decimais) |

O endpoint de produção existente suspende após 300 segundos; não se deve dizer
que a produção está sem autosuspend. O default `0` difere do endpoint atual e
aplica-se a computes futuros; é um ponto para revisão de drift/configuração, não
uma alteração automática. Os contadores da branch ficam próximos dos totais do
projeto; não os some como fontes independentes. As outras branches foram
pequenas em comparação, mas descendem da produção e não são ambientes isolados
seguros para carga sintética. Os dados da branch de produção e do projeto têm
timestamps próprios e foram lidos pela API de controle do Neon; não some as
fontes como se fossem independentes. Essas leituras não executaram SQL na base,
não atribuem custo a jobs ou queries e não demonstram redução após a mudança
local. Esse quadro é o snapshot histórico anterior, com timestamps de até
16:08 UTC; os dados foram preservados abaixo para comparação temporal.

### Atualização Neon anterior — 16/10/2026, 17:34:50 UTC (somente leitura)

| Campo | Valor observado |
|---|---|
| Compute de produção | 363.209 segundos |
| Tempo ativo de produção | 1.355.952 segundos |
| Atualização do snapshot | 2026-10-16 17:34:50 UTC |
| Inventário de branches | Somente `production`, duas branches `ready` derivadas de `parent-data`/produção e uma branch arquivada derivada de produção; nenhuma branch isolada de carga |
| Projeto Neon novo | O usuário recusou a criação; nenhum projeto foi criado |

Esta atualização substituiu os números anteriores como leitura mais recente
naquele momento. Os snapshots anteriores e seus timestamps permanecem
registrados como histórico. As branches derivadas de produção não são ambientes
seguros para carga sintética; teste de carga isolado segue pendente.

`pg_stat_statements_info.stats_reset` foi `2026-10-02T16:50:26.997Z`. Uma
consulta read-only limitada, ordenada por `rows`, executada às 14:35:22 UTC,
retornou os seguintes sinais de volume acumulados desde o reset:

| Query/resumo | Chamadas | Linhas retornadas | Linhas/chamada | Tempo SQL acumulado |
|---|---:|---:|---:|---:|
| `EventMapPublicSeat` — projeção completa | 6.642 | 1.483.590 | 223,36 | 14.429,32 ms |
| `WebhookAsaas` — candidatos para side effects | 10.011 | 168.098 | 16,79 | 1.105,21 ms |
| `EventMapPublicSeat` — lookup restrito `id + lotName` | 5.958 | 148.950 | 25,00 | 1.001,85 ms |
| `EventMapReservationSeat` | 5.671 | 119.948 | 21,13 | não fornecido nesta amostra |
| `EventTicket` | 5.671 | 119.837 | 21,13 | não fornecido nesta amostra |
| `EventMapOrderItem` | 5.671 | 119.837 | 21,13 | não fornecido nesta amostra |
| `EventSeat` — projeção completa | 245 | 109.760 | 448,00 | 491,47 ms |

As projeções antigas com `SELECT *` de `EventMapPublicSeat` incluíam metadados,
que os mappers atuais consomem, além de outros campos fora da projeção atual.
A alteração de projeção existente é local, sem evidência
de publicação nesta atualização; portanto, estas estatísticas precedem a
mudança local e não são uma medição do seu efeito. Um check predefinido que
consultava apenas `calls`/tempo não recuperava linhas por chamada; a nova
consulta read-only fornece este proxy de volume.

`rows` e `rows/call` não são bytes transferidos: não medem largura de coluna,
egress da query, trabalho útil do usuário ou custo Neon atribuível. A amostra
precisa de revisão de largura/campos no código e comparação pós-publicação em
janelas equivalentes com dados de transferência/egress disponíveis. Os
contadores globais de 4,479 GB não distribuem transferência por query. Não
havia locks retidos no instante da inspeção anterior; a agenda mede disparos
planejados, enquanto logs/contagens por etapa distinguem invocação, sucesso e
trabalho útil.

Essa amostra foi ordenada por `total_exec_time`; não preservou `rows/calls` nem
largura estimada dos resultados e, portanto, não identifica as maiores queries
por egress. O volume transferido observado foi 4,479 GB no período do projeto.
Os planos pagos do Neon passaram a incluir 500 GB de transferência mensal em
01/06/2026, mas o plano de cobrança desta conta não foi confirmado; não se deve
concluir apenas desse snapshot se houve ou não excedente faturável
([comunicado do Neon](https://neon.com/blog/more-data-transfer-on-paid-plans)).
As projeções reduzem colunas retornadas e podem reduzir tráfego e serialização,
mas essa mudança não comprova redução de compute-hours. Compare egress e CU-hours
como métricas distintas em janelas equivalentes após a publicação.

Os contadores de uso retornados pelo projeto e os contadores da listagem de
branches têm instantes de atualização próprios e podem divergir ligeiramente;
este quadro preserva o snapshot do registro de uso do projeto, sem somar essas
fontes.

### Atualização read-only consolidada — 16/10/2026, 17:51 UTC

As leituras abaixo têm timestamps separados por recurso; os contadores do projeto
Neon e da branch de produção são relacionados e não devem ser somados.

| Recurso | Atualização | Compute | Tempo ativo | Transferência / tamanho |
|---|---|---:|---:|---:|
| Projeto Neon | `2026-10-16T17:51:01Z` | 363.763 s | 1.358.096 s | 4.559.111.106 bytes transferidos |
| Branch `production` | `2026-10-16T17:44:47Z` | 363.209 s | 1.355.952 s | 4.558.535.541 bytes transferidos; 130.129.920 bytes lógicos |

O endpoint de produção `ep-winter-poetry-acfmrqjr` (`aws-sa-east-1`) estava
`current_state=active`, com `suspend_timeout=300s` e `last_active=2026-10-16T17:51:00Z`.
A produção tem suspensão configurada após 300 segundos; não está sem autosuspend.
O inventário contém a branch `production`, duas branches `ready` derivadas de
`parent-data`/produção e uma branch arquivada derivada de produção; nenhuma é
isolada para carga sintética. O usuário recusou a criação de um novo projeto
Neon; nenhum projeto foi criado, branch de Neon não foi criada e produção não foi
mutada. As branches derivadas de produção não devem receber carga sintética.

`pg_stat_statements_info.stats_reset` permanece em
`2026-10-02T16:50:26.997Z`. A amostra read-only atribuiu chamadas por role:

| SQL/resumo | Role | Chamadas | Tempo acumulado |
|---|---|---:|---:|
| `SELECT $1` | `cloud_admin` | 2.402.568 | 14.969 ms |
| `SELECT $1` | `neondb_owner` | 90.353 | 658 ms |
| `SELECT $1` | `alusa_app` | 3.536 | 18,6 ms |

As chamadas de `cloud_admin` e de roles de sistema não são evidência de uso da
aplicação e não podem ser atribuídas a jobs. Consultas relevantes atribuídas à
aplicação nesta janela acumulada:

| Consulta/resumo | Chamadas | Linhas retornadas | Tempo SQL acumulado |
|---|---:|---:|---:|
| `EventMapPublicSeat` — select completo | 6.646 | 1.484.486 (~223,37/chamada) | 14.437 ms |
| `EventMapVersion` — select com snapshot | 7.517 | 7.517 | 14.358 ms |
| `WebhookAsaas` — agregação | 10.357 | — | 7.615 ms |
| `FinanceInstallmentPlanReadModel` — upsert que devolve a linha completa | 13.366 | 13.366 | 1.628 ms |
| `WebhookJobLock` — update | 23.132 | — | 1.953 ms |
| `WebhookJobLock` — upsert | ~12.008 | — | baixo tempo acumulado |
| Varreduras da side-effect outbox | ~10.000–14.000 | — | baixo tempo acumulado |

Essa amostra precede os refactors locais. `rows` e tempo SQL não medem bytes de
egress, largura serializada, trabalho útil ou custo atribuível por job. As
projeções locais do mapa de eventos agora são mais estreitas e mantêm os metadados
e os campos do snapshot exigidos pelo DTO. No billing read model, os upserts locais
de parcelas agora selecionam apenas `id`; em `packages/finance`, o comando
`pnpm exec vitest run --config vitest.unit.config.ts src/read-model/__tests__/billing-read-model.installment-select.test.ts`
passou 2/2 e cobre os dois fluxos.
Não há evidência de deployment nem comparação antes/depois que demonstre redução
no uso de produção.

A consulta Vercel das últimas 24 horas para o deployment de produção
`dpl_HQceje4Xhy7C5Z68QmuCbv1tEhCa` (`main`) retornou 4.352 logs
`job.completed` de 15 rotas. São conclusões registradas em logs, não execuções
exatas de cron nem prova de trabalho útil; amostras antigas não têm `workStatus`
nem `correlationId`. Consultas Sentry dos últimos 14 dias para
`alusa.job.completed`, `alusa.finance.charge_sync.request` e spans de banco sob
`webhook-scheduler` não retornaram resultados. Isso não permite concluir que a
ingestão esteja saudável nem atribuir compute a rotas/jobs; a confirmação de
telemetria e a análise de workload seguem pendentes.

Os snapshots do projeto e da branch têm timestamps próprios e não são aditivos.
Esta atualização é read-only e não prova economia local, não autoriza alteração
de frequência e não valida uma branch isolada de carga, Neon staging ou produção.
O teste de carga isolado continua pendente.

### Snapshot histórico de validação local (anterior a 16/10/2026)

- `pnpm test` verde: 15 pacotes; `@alusa/finance` com 225 arquivos/1.807 testes e `@alusa/web` com 330 arquivos/1.574 testes;
- `pnpm typecheck` verde em todos os 15 pacotes;
- `pnpm build:web` verde com build de produção Next.js;
- `pnpm lint` sem erros; os avisos existentes permanecem fora do escopo desta onda;
- `pnpm workspace:check`, `pnpm validate:cron-config`, `pnpm audit:job-contracts`, `pnpm audit:route-boundaries`, `pnpm audit:http-contracts` e `pnpm security:check` verdes;
- fluxo E2E financeiro PR2–PR4 verde: 6/6 cenários, incluindo outbox de provisionamento, retry, idempotência e isolamento de vínculo;
- banco local de teste recriado com as 301 migrations aplicadas; nenhuma migration ou alteração foi aplicada em Neon/produção nesta onda;
- o arquivo legado `apps/web/e2e/matricula-wizard-full.spec.ts` permanece fora do gate crítico porque ainda contém `TODO`s de autenticação/navegação e cenários sem fixture; ele deve ser reescrito em uma onda própria, não mascarado com `skip`.

### Validação do clone limpo desta execução — 16/10/2026

O checkout foi copiado para um clone temporário, sem alterar o diretório de
trabalho original, e instalado com `pnpm install --frozen-lockfile`. No clone,
`pnpm prisma:generate`, `pnpm workspace:check`, `pnpm validate:cron-config`,
`pnpm audit:job-contracts`, `pnpm audit:route-boundaries`,
`pnpm audit:http-contracts`, `pnpm security:check`, `pnpm typecheck` e `pnpm lint`
terminaram com sucesso. O lint registrou zero erros e 900 avisos. A auditoria de
fronteiras encontrou 536 rotas, baseline de 166 imports diretos de Prisma e um
no estado atual, sem novos caminhos diretos; a auditoria HTTP encontrou 537
rotas sem violações. O build de produção executou o comando de build da Vercel
até a coleta de traces e listagem final das rotas. Como o clone não roda dentro
da Vercel, a validação de schema exclusiva do ambiente de produção foi
intencionalmente ignorada; o build usou um `NEXTAUTH_SECRET` efêmero de build,
sem credencial real.

`pnpm test` no clone terminou inicialmente com 265 arquivos aprovados, quatro
arquivos falhos, um ignorado e 2.377 testes aprovados contra cinco falhas. As
falhas eram expectativas antigas de prefixo de idempotência, fixtures
incompletas para a paginação integral do Asaas e uma regra de fronteira que
barrava o SDK num teste E2E opt-in. Essas expectativas/fixtures e a exceção
específica do teste E2E foram ajustadas no checkout. A suíte completa foi
repetida no checkout após as correções e terminou com código zero: no financeiro,
269 arquivos passaram e um foi ignorado (2.382 testes passaram, um ignorado); no
web, 435 arquivos e 2.057 testes passaram; no admin, cinco arquivos e oito
testes passaram. Os demais workspaces também terminaram sem falhas. O E2E Asaas
depende de sandbox/credenciais e não foi executado.

O destino de banco do guard de testes foi validado como `alusa_test` em
`localhost:5432`; durante os testes, Prisma encontrou 354 migrations e nenhuma
pendente nesse banco local. Esta validação não aplicou migrations em Neon nem
em produção. O build, typecheck, lint, testes e auditorias são evidência local;
não confirmam implantação, ingestão de telemetria, impacto de quota ou SLAs em
produção.

## 2. Diagnóstico de referência

As estatísticas de `pg_stat_statements` confirmam chamadas recorrentes da
plataforma, mas não permitem atribuir o compute agregado a uma rota ou job.
O quadro abaixo preserva um snapshot anterior ordenado por tempo SQL, coletado
em 16/10/2026 às 13:31:58 UTC, cobrindo 02/10/2026 16:50:26 UTC até essa
consulta. A amostra posterior ordenada por `rows` está detalhada acima. Ambos
os quadros são contagem/tempo/volume SQL agregado, não custo por operação:

| Sinal | Observação | Interpretação |
|---|---:|---|
| `BEGIN` / `COMMIT` | 88.508 / 88.507 chamadas | alta frequência; tempos acumulados individuais abaixo de 1 s |
| `SELECT $1` | 88.649 chamadas, 0,649 s | chamada muito frequente, mas baixo tempo SQL acumulado |
| consultas de vínculo e conta | cerca de 34,9–37,6 mil chamadas por padrão, 0,6–1,8 s cada acumulado | volume alto, tempo SQL acumulado baixo; revisar só com profiling por request |
| heartbeat/lock | 22.806 updates (1,913 s) e 11.827 upserts (1,188 s) | coordenação recorrente; sem evidência de espera de lock no snapshot |
| métricas da fila de webhook | 10.224 agregações, 7,496 s | polling observável, mas baixo tempo médio por chamada |
| leituras de mapa de eventos | `EventMapPublicSeat` projeção completa: 6.642 chamadas / 1.483.590 linhas / 223,36 linhas por chamada / 14.429 ms; `EventMapPublicSeat` lookup restrito: 5.958 / 148.950 / 25 / 1.002 ms; `EventSeat` projeção completa: 245 / 109.760 / 448 / 491 ms | linha retornada é proxy, não byte/egress nem custo; projeções menores locais não alteram chamadas e aguardam comparação pós-publicação |
| cron de 1 minuto | 1.440 execuções/dia por job | esperado pela configuração, mas cumulativo |
| cron de 5 minutos | 288 execuções/dia por job | deve ser avaliado pela quantidade de trabalho real |

Os valores são estatísticas acumuladas desde o último reset do PostgreSQL, não
uma porcentagem oficial da quota mensal. Na inspeção às 13:31 UTC não havia lock
retido, query ativa acima de 30 segundos nem query executando há mais de 5
minutos.
Esses snapshots não provam que a agenda cron seja a causa do consumo de compute;
para atribuição, correlacione por 7–14 dias invocações, trabalho útil, duração,
backlog/atraso e uso Neon antes/depois de uma mudança publicada.

## 3. Princípios obrigatórios

1. Nenhuma otimização pode remover filtro ou contexto de `contaId`.
2. Nenhuma cobrança, estorno, cancelamento ou pagamento pode depender de estado em memória.
3. Webhook, outbox, idempotência e reconciliação continuam sendo a base do financeiro.
4. Não trocar consistência financeira por performance aparente.
5. Não aumentar quota/compute antes de medir a causa.
6. Não criar uma fila externa apenas para substituir um polling sem entender o fluxo.
7. Toda mudança deve ter métrica antes/depois e rollback claro.
8. Jobs devem ser seguros para entrega pelo menos uma vez.
9. Alterações de schema devem ser aditivas, escopadas e backward-compatible.
10. Código novo deve respeitar as fronteiras documentadas em `AGENTS.md` e nos ADRs.

## 4. Arquitetura alvo

```text
Mutação HTTP / webhook / evento
          ↓
Transação local curta + outbox idempotente
          ↓
Dispatcher/cron leve
          ↓
Claim atômico de lote com lock/lease
          ↓
Worker com concorrência limitada por conta e tipo
          ↓
Retry com backoff ou DLQ
          ↓
Read model, auditoria e métricas
```

O cron deve acordar o sistema e despachar trabalho. Ele não deve executar uma varredura ampla de todas as contas em toda execução quando não houver itens elegíveis.

**Direção futura de transporte:** SQS + Lambda está fora desta fase, e a adoção de uma fila externa continua condicionada a evidência operacional. Enquanto isso, preparar os casos de uso para não dependerem do cron da Vercel como mecanismo de execução: preservar outbox durável, idempotência, deduplicação, retry, recovery e isolamento por `contaId` em contratos transport-agnostic. Não há prazo nem critério de migração definido; decidir isso em etapa futura com base nas métricas e evidências coletadas.

## 5. Fases de implementação

### Fase 0 — Baseline, ownership e segurança de mudança

**Objetivo:** estabelecer uma linha de base reproduzível antes de alterar frequência, queries ou infraestrutura.

**Entregas:**

- registrar os jobs existentes, frequência, rota, proprietário, objetivo, tabela/fila consultada e criticidade;
- mapear todos os cron jobs de `vercel.json` e `apps/web/vercel.json` para uma única matriz;
- classificar jobs como `CRITICAL_FINANCE`, `WEBHOOK`, `RECONCILIATION`, `READ_MODEL`, `NOTIFICATION` ou `MAINTENANCE`;
- registrar dependências entre jobs, outboxes e read models;
- documentar quais jobs podem rodar em paralelo e quais exigem exclusão mútua;
- criar owners por bounded context: `domain`, `finance`, `asaas`, `database`, `notifications`, `events`, `platform-billing` e `whatsapp`;
- garantir que nenhum `.env`, dump, log local, build ou artefato de teste seja versionado;
- remover somente artefatos comprovadamente descartáveis após inspeção e confirmação do estado do Git.

**Critérios de aceite:**

- 100% dos cron jobs catalogados;
- 100% dos jobs com owner, criticidade e estratégia de retry;
- baseline de quota, CPU, latência e volume registrado;
- nenhuma alteração de comportamento feita apenas para alterar números.

### Fase 1 — Observabilidade de quota e jobs

**Objetivo:** tornar o consumo explicável por job, conta e operação.

**Entregas:**

- criar log estruturado para início/fim de cada job;
- registrar `jobName`, `correlationId`, duração, lote, processados, ignorados, falhas, retries e atraso da fila;
- registrar `contaId` somente em formato seguro/redigido quando o log for externo;
- medir `queueDepth`, `queueLagMs`, `emptyRun`, `lockWaitMs` e `dbQueries` quando disponível;
- separar níveis `info`, `warn` e `error`;
- tratar replay idempotente esperado como `info`/`debug`, não como erro de produção;
- criar um relatório diário de quota com CPU, tempo ativo, armazenamento, transferência e tendência;
- criar alertas em 50%, 70%, 85% e 95% da quota configurada, quando a métrica oficial estiver disponível;
- manter os logs compatíveis com a limitação de telemetry do Neon na região atual, usando Vercel/runtime logs como fonte complementar.

**Critérios de aceite:**

- cada job informa se teve trabalho real;
- incidentes distinguem falha funcional, replay, timeout, fila vazia e lock concorrente;
- é possível apontar os cinco maiores consumidores por janela;
- nenhum segredo, payload financeiro completo ou dado pessoal aparece nos logs.

### Fase 2 — Dispatcher, polling e timers

**Objetivo:** reduzir chamadas vazias sem atrasar o financeiro.

**Entregas:**

- manter intervalos curtos apenas para webhook e cobrança com SLA definido;
- substituir `COUNT(*)` usado somente para existência por `EXISTS`, `SELECT 1 LIMIT 1` ou busca direta de lote;
- buscar o primeiro lote elegível em vez de contar toda a fila;
- implementar backoff para jobs sem trabalho;
- evitar que jobs de manutenção executem simultaneamente com reconciliações equivalentes;
- usar parâmetros de lote explícitos e pequenos, por exemplo 25, 50 ou 100 conforme o domínio;
- não executar `COUNT(*)` global quando a resposta não for usada para paginação ou métrica real;
- separar jobs urgentes de jobs de manutenção em agendas distintas;
- manter um intervalo máximo de segurança para que filas não fiquem esquecidas.

**Política inicial sugerida:**

| Tipo | Política |
|---|---|
| webhook financeiro | baixa latência, lote pequeno, lock por job/conta |
| provisionamento de matrícula | retry limitado e backoff |
| reconciliação de pagamento | execução periódica e limitada por orçamento |
| read model | execução por defasagem real, não por varredura cega |
| auditoria/arquivo | janela de baixa prioridade |
| fila vazia | encerrar rápido e aumentar o próximo intervalo |

**Critérios de aceite:**

- queda mensurável de execuções vazias;
- nenhum aumento do atraso de webhook ou reconciliação;
- nenhum job crítico duplicado;
- mesma cobertura operacional anterior.

### Fase 3 — Outbox, fila lógica e deduplicação

**Objetivo:** transformar trabalho recorrente em trabalho orientado a evento, sem adicionar infraestrutura desnecessária.

**Entregas:**

- garantir que mutações locais criem outbox na mesma transação quando aplicável;
- padronizar chave de deduplicação como `contaId + tipo + entidade + operação`;
- usar claim atômico com status, `lockedAt`, `lockedUntil`, `lockedBy` e heartbeat;
- processar com entrega pelo menos uma vez e handlers idempotentes;
- limitar tentativas por tipo de erro;
- usar backoff exponencial com jitter para falhas temporárias;
- mover itens esgotados para DLQ ou estado operacional equivalente;
- criar rotina de reprocessamento manual auditada;
- impedir que o mesmo evento seja consumido por dois caminhos sem coordenação;
- diferenciar retry de erro permanente, conflito de negócio e replay.

**Regras financeiras:**

- criação de cobrança, assinatura, customer, estorno e cancelamento devem ser idempotentes;
- chamada ao Asaas deve guardar correlação e resultado remoto;
- webhook recebido continua sendo persistido antes do processamento;
- falha do worker não pode apagar o evento recebido;
- uma duplicidade esperada não pode criar segundo efeito financeiro.

**Critérios de aceite:**

- replay do mesmo webhook produz o mesmo estado final;
- dois workers concorrentes não processam o mesmo item com efeitos duplicados;
- retry não cria segunda cobrança ou segunda assinatura;
- DLQ tem causa, tentativas e forma de recuperação.

**Evidência local adicional (16/10/2026):** o teste
`packages/lib/src/notifications/pending-inbox-notifications.integration.test.ts`
passou (1/1) em PostgreSQL descartável local `alusa_test_efficiency_20261016_04`,
com 352 migrations aplicadas desde o banco vazio. O teste usa Prisma e raw SQL
reais para provar claim único entre drains concorrentes da Conta A, retry após
falha transitória, conclusão na segunda tentativa com um único efeito de
notificação bem-sucedido e Conta B ainda PENDING/inalterada; o provider externo
fica mockado. É redução de uma lacuna do `PendingInboxNotification`, não prova
de cobertura uniforme dos oito fluxos nem aceite operacional Neon/staging ou
produção.

**Evidência local adicional (16/10/2026):**
`packages/finance/src/family-billing/enqueue-family-billing-outbox.integration.test.ts`
passou (1/1) no banco descartável PostgreSQL local
`alusa_test_efficiency_20261016_05`, após 352 migrations aplicadas desde o
banco vazio. Duas chamadas concorrentes para Conta A e a mesma chave retornaram
a mesma linha; Conta B manteve linha independente com a mesma `dedupeKey`. O
teste cobre apenas enqueue, sem provider externo. A cobertura dos oito fluxos
continua parcial e não há aceite operacional Neon/staging/produção.

**Evidência local adicional (16/10/2026):** no banco PostgreSQL descartável
`alusa_test_efficiency_20261016_06`, com 352 migrations aplicadas, passaram
`tenant-notification-preferences.test.ts` (4/4), os testes unitários de
`sync-customer-notifications-at-charge` e
`asaas-notification-preference-outbox.service` (9/9 combinados), e
`notification-outbox-claim.integration.test.ts` (2/2). A integração demonstrou
que um PUT antigo que termina após perder o fencing claim reabre a linha com a
preferência atual da Conta e que o drain seguinte converge novamente; Conta B
permanece pendente. O PUT é mockado, e a validação é local, sem Neon, staging ou
produção. O banco descartável foi removido após os checks; `prisma migrate status`
estava limpo antes da remoção.

### Fase 4 — Concorrência e limites por tenant

**Objetivo:** impedir que uma conta, job ou integração consuma todo o compute.

**Entregas:**

- definir concorrência máxima por classe de job;
- aplicar fairness por `contaId`, evitando que uma conta grande monopolize um lote;
- limitar chamadas Asaas por conta e por janela;
- preservar circuit breaker e fallback do rate limiter;
- separar limite de API interna, webhook e job interno;
- usar locks distribuídos somente onde há risco real de concorrência;
- medir espera por lock e taxa de lock expirado;
- impedir spawn ilimitado de promises em lotes grandes;
- cancelar trabalho excedente quando o orçamento de duração ou chamadas for atingido.

**Critérios de aceite:**

- uma conta com backlog não degrada as demais;
- nenhum job ultrapassa seu orçamento de duração sem registrar motivo;
- o limite não bloqueia login ou operação normal de usuários;
- o financeiro continua processando sob concorrência controlada.

### Fase 5 — Otimização segura do PostgreSQL/Neon

**Objetivo:** reduzir custo por operação sem migrations arriscadas.

**Entregas:**

- revisar queries com maior `total_exec_time` e maior `ncalls` separadamente;
- classificar egress também por `rows` e `rows/calls`, inspecionando colunas
  grandes (`JSONB`, `TEXT`, `BYTEA`) nas consultas mais volumosas;
- substituir `COUNT(*)` por existência quando aplicável;
- usar `select` mínimo no Prisma;
- remover N+1 com `include` ou filtros `IN`/batch;
- confirmar índices compostos iniciados por `contaId` nas filas e tabelas tenant-scoped;
- executar `EXPLAIN` somente em branch/ambiente controlado antes de alterar índices;
- revisar queries de ordenação por `createdAt`, `updatedAt`, `recebidoEm` e `nextAttemptAt`;
- manter pooler transacional e pool de conexões compatível com serverless;
- acompanhar autovacuum, dead tuples, bloat e tamanho de índices;
- criar índices de forma concorrente quando necessário e suportado, com migration operacional própria;
- nunca usar `VACUUM FULL`, drop de índice ou migration destrutiva diretamente em horário crítico sem runbook.

**Critérios de aceite:**

- melhoria comprovada no p95 ou no número de chamadas;
- plano de execução revisado;
- nenhum aumento de risco cross-tenant;
- nenhuma regressão em matrícula, cobrança ou webhook.

### Fase 6 — API, frontend e requisições duplicadas

**Objetivo:** evitar que a UI gere sincronizações repetidas ou waterfalls desnecessários.

**Entregas:**

- inventariar chamadas duplicadas por tela e por hook;
- garantir uma única fonte de dados por tela de cobrança/matrícula;
- impedir `sync-asaas` automático em múltiplos componentes simultaneamente;
- deduplicar requests por chave de recurso e janela curta;
- usar cache/revalidação para dados de leitura que não exigem consulta a cada renderização;
- invalidar cache somente após mutação relevante;
- evitar polling agressivo no cliente;
- usar estado de loading compartilhado e cancelamento de requests obsoletas;
- manter respostas HTTP, paginação, `ETag`/cache-control e erros estáveis;
- separar consulta local de ação explícita de sincronização remota.

**Critérios de aceite:**

- abrir uma cobrança não dispara chamadas idênticas concorrentes;
- consulta de tela não altera estado financeiro silenciosamente sem idempotência;
- cache nunca ultrapassa o tenant autorizado;
- a UI continua exibindo estado local e informa quando houve reconciliação remota.

#### Auditoria local de consumidores de `sync-asaas` (16/10/2026)

| Consumidor | Comportamento observado | Leitura operacional |
|---|---|---|
| Lista `/charges` | `useVisibleChargeConvergence` tenta sincronizar cobranças não terminais visíveis; `maxItems` acompanha `pageSize`. A lista também tem atualização local a cada 45s. | Fallback automático para webhooks/realtime. Medir candidatos, tentativas e `skipped` antes de alterar janela ou limite do lote. |
| Lista `/charges/one-time` | Usa o mesmo hook para os itens da página visível e atualiza a lista local periodicamente. | Mesmo fallback; chamadas compartilham o coalescer do cliente quando endpoint e cobrança coincidem. |
| Lista `/finance/charges` | A tabela usa o hook, limitado a no máximo quatro cobranças por execução; atualização local a cada 45s. | Limite mais explícito; confirmar se os filtros e o estado exibido justificam convergir todos esses itens. |
| Portal de detalhes | O mesmo hook verifica uma cobrança por vez via `/api/portal/financeiro/{id}`, com throttle de 10s. | É uma rota e uma autorização distintas; não deve ser deduplicada com o endpoint administrativo. |
| Detalhe administrativo | `useCobrancaDetailQuery` lê estado local, faz fallback assíncrono para cobrança não terminal e usa polling de 15s, 3s para estados transitórios e 2,5s durante burst. | O primeiro carregamento não espera o Asaas; webhook permanece primário. O helper compartilhado coalesce tentativas automáticas que usam o mesmo endpoint/chave. |
| Ações de cobrança, emissão e mutações financeiras | `ChargeActionsMenu`, `ChargeInvoiceSection` e `CobrancaDetalhesClient` fazem POST explícito após ação do usuário ou mutação para obter links/estado atualizado. | São chamadas com resultado e momento funcional próprios; não substituir diretamente por helper que retorna apenas boolean. Podem coincidir temporalmente com o fallback automático e devem ser observadas. |

O helper `requestCobrancaAsaasSync` compartilha requisições em voo e aplica throttle no cliente por endpoint e cobrança. O `POST /api/cobrancas/[id]/sync-asaas` (rota administrativa) autentica a sessão, exige papel permitido, resolve a cobrança dentro de `contaId`, limita taxa por conta/usuário/cobrança e invalida o cache com a conta. O `POST /api/portal/financeiro/[id]` usa a sessão do portal e resolve o pagamento no escopo próprio de aluno/responsável; não se afirma que essa rota use o rate limit administrativo. Isso preserva escopos distintos no servidor, mas ainda não demonstra a quantidade de chamadas que se sobrepõem em produção.

Os handlers POST de sincronização registram `alusa.finance.charge_sync.request`
e `alusa.finance.charge_sync.duration`. `operation.name` diferencia apenas
`automatic_fallback` e `explicit_action`; `result` é `success`, `skipped` ou
`failure`; `http.route` separa `/api/cobrancas/:id/sync-asaas` de
`/api/portal/financeiro/:id`. O contador não é amostrado; a distribuição de duração segue
`OBSERVABILITY_METRIC_SAMPLE_RATE`. O helper client envia a origem fixa no
header `x-alusa-sync-source`; valor ausente ou fora da allowlist é tratado como
ação explícita. As métricas não incluem identificadores nem detalhes do erro.
O contador cobre POSTs que chegaram aos handlers; tentativas suprimidas pelo
coalescer/throttle local não chegam ao servidor e não são contadas. Não há
ainda evidência de ingestão dessas métricas em produção.

Não foi identificada nesta leitura uma duplicação automática inequívoca que justifique remover consumidores. A ação seguinte é instrumentar/observar chamadas automáticas e explícitas separadamente, verificar cache e invalidação ao alternar conta e avaliar se o limite de `pageSize` da lista `/charges` precisa de um teto equivalente ao da tabela financeira. Nenhuma frequência foi alterada nesta auditoria.

Verificação local adicional: `tests/unit/cobrancas.sync-asaas.post.test.ts` passou com 3/3 testes. A cobertura confirma que a busca usa o `contaId` autenticado, que as chaves do rate limit ficam restritas à conta/usuário/cobrança autorizados e que a invalidação de cache usa conta e cobrança autenticadas apenas após sucesso (sem invalidação em throttle ou falha). É evidência do contrato local da rota; ainda falta evidência pós-rollout em produção sobre chamadas sobrepostas, métricas e comportamento operacional.

### Fase 7 — Organização do workspace e código limpo

**Objetivo:** garantir que a redução de consumo não crie novos acoplamentos.

**Estrutura alvo:**

```text
apps/web/app                  # páginas e wrappers HTTP finos
apps/web/features             # contratos e adapters de interface por contexto
apps/web/src/server           # casos de uso e serviços de aplicação
packages/domain               # regras acadêmicas puras
packages/finance              # casos de uso financeiros e reconciliação
packages/asaas                # cliente HTTP tipado e neutro
packages/asaas-gateway        # contratos/verificação de integração
packages/database             # Prisma, repositories e transações
packages/shared               # tipos/utilitários sem infraestrutura
packages/lib                  # somente cross-cutting realmente compartilhado
packages/ui                   # componentes visuais
scripts                       # auditorias e operação reproduzível
docs/architecture             # ADRs, contratos e ownership
docs/runbooks                 # procedimentos operacionais
docs/plans                    # planos e critérios de aceite
```

**Entregas:**

- impedir novos serviços genéricos em `packages/lib`;
- mover código novo para o bounded context correto;
- manter route handlers com autenticação, parsing, caso de uso e resposta;
- remover duplicação somente após inventário de consumidores;
- manter nomes canônicos e aliases documentados;
- criar README curto por pacote com responsabilidade, dependências e owner;
- manter scripts de auditoria para rotas, DTOs, limites, cron e grafo de pacotes;
- não versionar `.next`, `.turbo`, `dist`, `node_modules`, relatórios locais ou arquivos de sistema;
- manter comandos root únicos para lint, typecheck, testes, build, segurança e validação de workspace.

**Critérios de aceite:**

- nenhuma regra financeira em componente React ou wrapper HTTP;
- nenhum import proibido novo;
- nenhum pacote sem responsabilidade clara;
- clone limpo reproduz a validação documentada.

### Fase 8 — Testes adversariais e operação

**Objetivo:** provar que a economia de quota não reduz segurança ou confiabilidade.

**Entregas:**

- testes unitários para backoff, deduplicação, claim, lease e classificação de erro;
- testes de concorrência com dois workers;
- testes Conta A/Conta B para todos os jobs e read models;
- testes de replay de webhook e retry de Asaas;
- testes de cobrança/matrícula com falha parcial;
- testes de fila vazia, fila cheia e item preso;
- E2E do fluxo aluno → matrícula → contrato → cobrança → webhook → portal, incluindo isolamento Conta A/B e fixture adversarial de cobrança da Conta B vinculada à matrícula A (evidência local abaixo);
- teste de carga controlado em branch/staging Neon;
- runbook para DLQ, webhook atrasado, quota, lock preso e rollback;
- checklist de pós-deploy com logs, erros, filas e reconciliação.

**Critérios de aceite:**

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm security:check` e auditorias verdes;
- E2E crítico verde em staging com dados Conta A/B;
- nenhuma falha de isolamento;
- métricas antes/depois anexadas ao change record.

**Evidência local (16/10/2026):** em um banco descartável recém-criado
`alusa_efficiency_test_20261016_02`, PostgreSQL 15, `prisma migrate deploy`
aplicou as 354 migrations desde o banco vazio e `prisma migrate status`
informou que o schema estava atualizado. O E2E
`enrollment-finance-portal-webhook.spec.ts` passou (1/1) nesse banco. O cenário
mantém o fluxo A de aluno → matrícula → contrato → cobrança → webhook → portal
e verifica que o portal A não lista nem acessa detalhes de uma cobrança de B,
incluindo fixture adversarial com `contaId` de B e matrícula de A. Essa é
validação local em banco descartável; não é validação Neon/staging nem evidência
de produção. Permanecem pendentes teste de carga em Neon/staging isolado,
cobertura Conta A/B para todos os jobs e read models, e métricas/aceite
pós-publicação.

**Validação local adicional (16/10/2026):** `pnpm --filter @alusa/lib exec
vitest run src/notifications/pending-inbox-notifications.integration.test.ts`
passou (1/1) no banco descartável local `alusa_test_efficiency_20261016_04`,
após `prisma migrate deploy` aplicar as 352 migrations. A cobertura exercita o
claim/retry concorrente de `PendingInboxNotification` com Conta A/B e provider
mockado. O banco temporário foi removido após o teste. Isso não conclui o teste
de carga Neon/staging isolado, a cobertura A/B uniforme de todos os jobs/read
models nem o aceite operacional; nenhum ambiente Neon, staging ou produção foi
usado ou alterado.

**Status local adicional (16/10/2026):** a precedência definida por produto
agora está coberta no backend: preferências salvas da escola prevalecem; canais
guardados na cobrança são fallback somente quando ainda não há preferências da
Conta. O outbox re-enfileira a intenção atual após PUT stale concluído sem claim,
sem permitir que o worker antigo finalize a nova linha. Os seletores de canais
na UI agora comunicam a regra e não apresentam a seleção da cobrança como
sobrescrita da preferência escolar. Isso não altera os
gates pendentes de Neon/staging isolado, teste de carga, cobertura A/B de todos
os jobs e read models, nem aceite operacional.

**Validação local adicional (16/10/2026):**
`packages/finance/src/family-billing/enqueue-family-billing-outbox.integration.test.ts`
passou (1/1) em `alusa_test_efficiency_20261016_05`, PostgreSQL descartável em
loopback com 352 migrations aplicadas. O teste provou convergência concorrente
do enqueue na Conta A e isolamento da mesma chave na Conta B, sem chamada a
provider. O banco temporário foi removido após a execução. Não representa
validação Neon/staging, produção, nem fecha a cobertura A/B de todos os jobs e
read models ou o aceite operacional.

## 6. Priorização

### P0 — Segurança e confiabilidade

- instrumentação dos jobs críticos;
- deduplicação e idempotência;
- locks/leases e concorrência por conta;
- testes de replay e cross-tenant;
- tratamento correto de DLQ e falhas financeiras.

### P1 — Redução imediata de quota

- eliminar `COUNT(*)` de existência;
- reduzir polling de filas vazias;
- processar em lotes;
- limitar transações pequenas repetitivas;
- deduplicar requests de telas de cobrança;
- separar reconciliação de manutenção.

### P2 — Performance e organização

- revisar índices e planos;
- eliminar N+1;
- selecionar somente campos necessários;
- decompor `packages/lib`;
- consolidar documentação e ownership.

### P3 — Evolução futura

- fila dedicada Redis/BullMQ ou serviço equivalente, somente se as métricas justificarem;
- worker persistente fora do ciclo curto da Vercel;
- telemetry centralizada quando disponível para a região/plano;
- particionamento ou retenção avançada para tabelas de histórico.

## 7. Métricas de sucesso

Após cada onda, medir pelo menos uma janela de 7 a 14 dias:

- redução de execuções vazias;
- redução de `COUNT(*)` de fila;
- redução de `BEGIN`/`COMMIT` por operação útil;
- CPU seconds por conta e por job;
- p50/p95 de duração dos jobs;
- atraso p95 de webhook;
- taxa de retry e DLQ;
- duplicidades idempotentes;
- chamadas Asaas por matrícula/cobrança;
- erros HTTP 5xx;
- isolamento Conta A/B;
- crescimento de `WebhookAsaas`, `AuditLog` e tabelas de reconciliação.

Nenhuma otimização será considerada bem-sucedida apenas porque reduziu queries; ela precisa manter ou melhorar confiabilidade e tempo de processamento.

## 8. Estratégia de rollout e rollback

1. Implementar uma mudança pequena atrás de configuração ou allowlist quando possível.
2. Validar localmente e em branch/staging.
3. Comparar métricas com a baseline.
4. Promover em janela segura.
5. Monitorar Vercel e Neon por pelo menos uma janela operacional.
6. Reverter somente a mudança isolada se houver aumento de erro, atraso ou inconsistência.
7. Não fazer migration destrutiva junto com alteração de scheduler.
8. Não alterar todos os timers simultaneamente.

Migrations futuras devem seguir expansão → backfill idempotente → leitura dupla, se necessário → constraint → limpeza posterior. O plano não requer migration para a primeira onda.

## 9. Referências técnicas

- [Prisma — boas práticas de queries, `select`, N+1 e pool de conexões](https://www.prisma.io/docs/orm/v7/more/best-practices)
- [Next.js — caching, revalidação e invalidação orientada a eventos](https://nextjs.org/docs/app/building-your-application/caching)
- [BullMQ — retry com exponential backoff](https://docs.bullmq.io/guide/retrying-failing-jobs)
- [BullMQ — deduplicação de jobs](https://docs.bullmq.io/guide/jobs/deduplication)
- [Plano geral de organização e modernização da Alusa](./workspace-organization-and-modernization-plan.md)
- [Fronteiras da camada Asaas](../adr-asaas-layer-boundaries.md)
- [Runbook de deploy de produção](../runbooks/deploy-production.md)
- [Runbook de jobs e quota](../runbooks/jobs-and-quota.md)

## 10. Resultado esperado

Ao final, a Alusa deverá possuir:

- jobs orientados a trabalho real, não a polling indiscriminado;
- filas idempotentes, deduplicadas e observáveis;
- concorrência controlada por tenant;
- menor custo de compute sem perda de consistência;
- API e frontend sem sincronizações duplicadas;
- queries e transações mais eficientes;
- workspace com ownership e fronteiras claras;
- testes que comprovem segurança, financeiro e multi-tenancy;
- operação preparada para crescer antes de adotar infraestrutura adicional.

O plano deve ser executado de forma incremental. Nenhuma fase posterior deve mascarar falha de uma fase anterior, especialmente em isolamento tenant, webhooks, cobranças ou reconciliação.
