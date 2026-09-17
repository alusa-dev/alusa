# Plano de eficiência, confiabilidade e organização sistêmica da Alusa

**Status:** implementação local em execução controlada; mudanças de produção dependem de rollout e observação operacional
**Data:** 17/09/2026
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

## 1.1 Registro de execução

Nesta onda foram implementados e validados localmente:

- observabilidade JSON para jobs críticos, sem serializar payloads ou segredos;
- catálogo dos 34 cron jobs com owner, criticidade, retry e grupo de exclusão;
- auditoria automática de contratos dos 43 route handlers de jobs;
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

### Snapshot de validação local

- `pnpm test` verde: 15 pacotes; `@alusa/finance` com 225 arquivos/1.807 testes e `@alusa/web` com 330 arquivos/1.574 testes;
- `pnpm typecheck` verde em todos os 15 pacotes;
- `pnpm build:web` verde com build de produção Next.js;
- `pnpm lint` sem erros; os avisos existentes permanecem fora do escopo desta onda;
- `pnpm workspace:check`, `pnpm validate:cron-config`, `pnpm audit:job-contracts`, `pnpm audit:route-boundaries`, `pnpm audit:http-contracts` e `pnpm security:check` verdes;
- fluxo E2E financeiro PR2–PR4 verde: 6/6 cenários, incluindo outbox de provisionamento, retry, idempotência e isolamento de vínculo;
- banco local de teste recriado com as 301 migrations aplicadas; nenhuma migration ou alteração foi aplicada em Neon/produção nesta onda;
- o arquivo legado `apps/web/e2e/matricula-wizard-full.spec.ts` permanece fora do gate crítico porque ainda contém `TODO`s de autenticação/navegação e cenários sem fixture; ele deve ser reescrito em uma onda própria, não mascarado com `skip`.

## 2. Diagnóstico de referência

As medições atuais indicam que o consumo do Neon é gerado principalmente por trabalho recorrente da própria plataforma:

| Sinal | Observação | Interpretação |
|---|---:|---|
| `BEGIN`/`COMMIT` | aproximadamente 25 mil de cada nas estatísticas atuais | muitas operações pequenas e jobs frequentes |
| contagem de webhooks | aproximadamente 7,8 mil chamadas | polling de filas/status |
| contagem de webhooks pendentes | aproximadamente 6,8 mil chamadas | reconciliação e monitoramento repetidos |
| heartbeat/lock | aproximadamente 5,6 mil updates e 4 mil upserts | coordenação de workers |
| read models/reconciliação | milhares de chamadas | manutenção e projeções recorrentes |
| cron de 1 minuto | 1.440 execuções/dia por job | esperado pela configuração, mas cumulativo |
| cron de 5 minutos | 288 execuções/dia por job | deve ser avaliado pela quantidade de trabalho real |

Esses números são estatísticas acumuladas desde o último reset do PostgreSQL, não uma porcentagem oficial da quota mensal. Não há evidência atual de saturação, lock prolongado ou query ativa acima de 30 segundos.

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
- E2E do fluxo aluno → matrícula → contrato → cobrança → webhook → portal;
- teste de carga controlado em branch/staging Neon;
- runbook para DLQ, webhook atrasado, quota, lock preso e rollback;
- checklist de pós-deploy com logs, erros, filas e reconciliação.

**Critérios de aceite:**

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm security:check` e auditorias verdes;
- E2E crítico verde em staging com dados Conta A/B;
- nenhuma falha de isolamento;
- métricas antes/depois anexadas ao change record.

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
