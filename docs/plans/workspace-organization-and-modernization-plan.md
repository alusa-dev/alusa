# Plano de organização, correção e melhoria do workspace Alusa

**Data do diagnóstico:** 16/09/2026
**Escopo:** monorepo, API, camadas, segurança multi-tenant, financeiro, testes, configuração e operação.

> Nota de rastreabilidade: os números de arquivos modificados nas seções de
> diagnóstico são snapshots do início da execução. O worktree já possuía
> alterações do usuário e esta implementação também não foi commitada; nenhum
> reset, checkout destrutivo ou limpeza ampla foi executado.

## 0.1 Status de implementação verificado

Esta execução implementou as fases locais de modernização segura e deixou os
guardrails permanentes no workspace. O estado abaixo é baseado em comandos
executados, não em suposição:

### Atualização de implementação — 17/09/2026

As ondas seguintes foram implementadas no código e nos contratos de fronteira:

- 519 rotas continuam inventariadas; `pnpm audit:route-boundaries` agora mede
  **0 rotas com Prisma direto**, **0 imports diretos de Asaas**, **0 novos
  caminhos** e **0 retornos
  prováveis de `Error.message`**;
- a suíte E2E production-like passou no cadastro público (2/2), no gate crítico
  de contratos (18/18), no wizard de aluno (7/7), no editor de mapas (2/2) e
  nos cenários corrigidos de colaborador/webhook (2/2), no fluxo financeiro de
  criação/agrupamento (13/13) e nas regras de domínio de matrícula (22/22);
- foram extraídos serviços para perfil/conta, LGPD, contratos públicos e OTP,
  modelos de contrato, WhatsApp, storage, early access, health, fixtures de
  teste, Stripe platform billing, matrícula/financeiro e rematrícula;
- os handlers críticos de eventos também foram reduzidos a wrappers HTTP:
  registro de participantes (inclusive agrupado), detalhe, mutações e geração
  de carnê agora ficam em serviços de aplicação tenant-scoped; a edição de
  matrícula segue o mesmo padrão;
- os fluxos de matrícula preservam `contaId`, idempotência, reconciliação,
  auditoria e a regra de webhook como fonte de verdade financeira;
- o inventário determinístico e a matriz de arquitetura foram regenerados
  após as extrações.
- as convenções de métodos, status, envelopes e exceções HTTP foram
  formalizadas em `docs/architecture/api-http-conventions.md`; o gate
  `pnpm audit:http-contracts` verifica violações estáticas e a rota legada de
  cobranças passou a responder `201` na criação e `422` para payload/query
  inválidos, preservando o payload compatível dos consumidores existentes.

Isso representa 100% das entregas locais de organização e fronteiras previstas
no plano. “100%” aqui significa implementação e validação reproduzível no
workspace; aceite operacional continua dependendo dos ambientes externos
descritos na seção de pendências.

| Área | Evidência atual |
|---|---|
| Workspace | `pnpm workspace:check` verde; tasks do VS Code e referências locais consolidadas. |
| API | 519 rotas inventariadas; `pnpm audit:route-boundaries` verde com 0 rotas com Prisma direto (baseline histórico 166), 0 imports diretos de Asaas, 0 novos caminhos e 0 retornos genéricos de `Error.message`. Serviços de aplicação preservam adapters locais de Prisma durante a migração para não quebrar contratos de teste e dependências existentes. |
| Contratos HTTP | Helper de resposta estável, testes de 5xx sem vazamento e aplicação nos fluxos críticos de cobrança/matrícula. |
| Extração | `cobrancas/[id]`, `matriculas/[id]`, eventos/participantes, alunos, responsáveis e rematrículas passaram a usar serviços de aplicação separados; wrappers HTTP permanecem finos. |
| Tamanho de handlers | `pnpm audit:route-sizes` verde: 519 rotas auditadas e 0 handlers acima de 300 linhas. |
| Tenant e segurança | `pnpm security:check` verde; modelos tenant-scoped com RLS detectável e inventário de proteção por rota em `api-route-boundary-inventory.json`. |
| DTOs | `pnpm audit:dtos` verde; 0 rotas com Prisma sem DTO/schema de entrada. |
| Canonicalização | 5 famílias e 5 aliases catalogados e protegidos por `pnpm audit:api-canonicalization`. |
| Qualidade | `pnpm test` verde e serializado: 686 arquivos e 4.125 casos contabilizados (4.096 aprovados e 29 skips explícitos), incluindo Web, Finance, Lib, Domain, Database, Shared, Admin e Mobile; `pnpm -w typecheck` 26/26; `pnpm -w build` 13/13. |
| E2E production-like | Runner usa `next start` com build isolado, papel RLS least-privilege e Redis REST explícito; cadastro público 2/2, gate crítico 18/18, wizard de aluno 7/7, editor de mapas 2/2, cenários colaborador/webhook 2/2, fluxo financeiro 13/13 e regras de matrícula 22/22. A suíte ampla de 240 cenários ainda requer estabilização e o aceite de staging continua pendente. |
| CI | Gates de workspace, fronteiras, inventário de rotas e canonicalização adicionados ao pipeline. |

As fases de código e governança local estão concluídas. Permanecem itens de
aceite operacional e limpeza incremental, que não podem ser falsificados por
uma execução local:

- os serviços de aplicação de eventos/matrículas ainda usam gateways de
  persistência nomeados durante a compatibilidade; novas alterações devem
  continuar extraindo casos de uso antes de ampliar esses serviços;
- o inventário classifica todas as 519 rotas e não encontra retornos genéricos
  de `Error.message`; mensagens de domínio explicitamente controladas devem
  permanecer cobertas por testes de contrato;
- aliases foram catalogados, mas a remoção exige inventário de consumidores,
  telemetria, compatibilidade e validação em staging;
- `packages/lib` ainda possui responsabilidades abrangentes, apesar da
  documentação de ownership e da barreira de imports já existentes;
- validação Conta A/B em staging, E2E completo dos fluxos financeiros,
  carga, DLQ/reconciliação operacional e promoção de migrations ainda não
  foram comprovados nesta execução;
- os cenários E2E production-like críticos passaram, mas a execução ampla de
  240 cenários ainda encontrou fixtures antigos de matrícula/financeiro,
  contratos de resposta legados e dependências de dados representativos; isso
  não substitui a execução em staging com Redis, Asaas sandbox, HMAC e dados
  Conta A/B reais;
- o lint termina sem erros, mas ainda reporta 1.276 warnings legados no
  monorepo (930 somente na aplicação Web); o baseline versionado impede novos
  warnings.

Esses números são o novo ponto de controle. Nenhuma etapa pendente deve ser
declarada concluída por alteração de baseline, `skip`, relaxamento de tipos ou
remoção de teste.

### Validação final desta execução

| Gate | Resultado |
|---|---|
| `pnpm test` | Verde e serializado: 686 arquivos e 4.125 casos contabilizados (4.096 aprovados e 29 skips explícitos); inclui as suítes de Web, Finance, Lib, Domain, Database, Shared, Admin, Mobile e demais packages. |
| `pnpm -w typecheck` | Verde: 26/26 tarefas. |
| `pnpm -w build` | Verde: 13/13 tarefas; Web e Admin compilados. |
| E2E production-like | Verdes: cadastro público 2/2, gate crítico 18/18, wizard de aluno 7/7, editor de mapas 2/2, cenários colaborador/webhook 2/2, fluxo financeiro 13/13 e regras de matrícula 22/22. A suíte ampla de 240 cenários ainda requer estabilização e aceite dedicado. |
| `pnpm -w lint` / `pnpm lint:check` | Verde, 0 erros e 1.276 warnings legados no monorepo (930 na Web); o ratchet por regra impede regressão. |
| `pnpm workspace:check` | Verde: estrutura, lockfile, tasks e referências consistentes. |
| `pnpm security:check` | Verde: RLS detectável, proteção de rotas, segredos e políticas legais. |
| `pnpm audit:route-boundaries` | Verde: 519 rotas, 0 Prisma direto, 0 Asaas direto, 0 novos caminhos, 0 retornos genéricos inseguros; o gate falha quando detecta retorno multiline de `Error.message`/`String(error)`. |
| `pnpm audit:route-sizes` | Verde: 519 rotas auditadas, 0 handlers acima de 300 linhas. |
| `pnpm audit:route-inventory` | Verde: 519 rotas classificadas e inventário determinístico atualizado. |
| `pnpm audit:dtos` | Verde: 0 rotas Prisma sem DTO/schema de entrada. |
| `pnpm audit:api-canonicalization` / `pnpm audit:lib-boundaries` | Verdes: 5 famílias/5 aliases e nenhum import do barrel genérico de `@alusa/lib` no runtime do workspace; CPF/CNPJ e calendário acadêmico já usam `@alusa/shared`. |
| `pnpm audit:http-contracts` | Verde: 520 rotas analisadas, 0 violações bloqueantes; 125 revisões não bloqueantes registradas para comandos legados que usam `200` de forma deliberada. |
| `pnpm validate:cron-config` | Verde: 34 crons alinhados entre manifests. |
| `git diff --check` | Verde. |

Os gates locais de código estão concluídos. A aceitação operacional ainda exige
execução em staging/produção-like para Conta A/B, sandbox Asaas, HMAC real,
carga, DLQ/reconciliação, dispositivo Mobile e promoção de migrations; esses
itens não podem ser simulados honestamente apenas pelo workspace local.

## 1. Mapa atual do sistema

### 1.1 Workspace

```text
.
├── apps/
│   ├── web/       Next.js principal: UI, BFF/API, portal e jobs HTTP
│   ├── admin/     Next.js de suporte/administração operacional
│   └── mobile/    Expo/React Native; consome /api/mobile do web
├── packages/
│   ├── domain/            regras acadêmicas puras
│   ├── finance/           casos de uso financeiros, Asaas, webhooks e reconciliação
│   ├── asaas/             cliente HTTP puro do Asaas
│   ├── asaas-gateway/     contratos técnicos e verificação de webhook
│   ├── database/          Prisma, repositories e credenciais
│   ├── lib/               serviços compartilhados atualmente abrangentes
│   ├── shared/            tipos, validadores e formatadores
│   ├── platform-billing/  cobrança da plataforma via Stripe
│   ├── stripe/            cliente/contratos Stripe
│   ├── whatsapp/          integração WhatsApp
│   ├── admin-auth/        autenticação do app admin
│   └── ui/                componentes compartilhados
├── prisma/                schema, Zod gerado e migrations
├── scripts/               validações, operação, segurança e suporte
├── docs/                  ADRs, runbooks, planos e hardening
└── .agents/               contratos operacionais dos agentes
```

### 1.2 Superfície HTTP

- `apps/web/app/api`: 492 route handlers.
- `apps/admin/app/api`: 27 route handlers.
- Total observado: 519 handlers.
- Maiores grupos do web: `events` (48), `mobile` (47), `jobs` (43), `financeiro` (38), `finance` (23), `matriculas` (20), `rematriculas` (14) e `cobrancas` (13).
- Entradas transversais: autenticação, `proxy.ts`, registry de proteção de rotas, sessão tenant, RLS, rate limit, cache, observabilidade e jobs.

### 1.3 Fluxo principal de negócio

```text
Conta/tenant
  → usuário e permissões
  → aluno e responsável financeiro
  → matrícula/rematrícula
  → contrato
  → customer/subconta Asaas
  → cobrança, assinatura ou parcelamento
  → webhook Asaas
  → pagamento/reconciliação/read model
  → portal, notificações, relatórios e auditoria
```

Fluxos laterais que cruzam a cadeia: eventos e ingressos, vendas/estoque, aulas/frequência, KYC, notas fiscais, WhatsApp, cobrança da plataforma, privacidade/LGPD e suporte administrativo.

### 1.4 Dados e integrações

- Prisma possui aproximadamente 196 models, 189 enums e mais de 300 migrations.
- `Conta` é a autoridade do tenant; entidades operacionais devem carregar ou alcançar `contaId`.
- Asaas é integrado através de `packages/finance`, com cliente HTTP em `packages/asaas` e contratos em `packages/asaas-gateway`.
- Webhooks, inbox/outbox, leases, locks, idempotência, read models e reconciliação já existem como infraestrutura de confiabilidade.
- Stripe é usado para platform billing; WhatsApp possui outbox e estados próprios.

## 2. Diagnóstico consolidado

### Pontos que devem ser preservados

- Monorepo `pnpm` + Turborepo.
- Separação conceitual entre `domain`, `finance`, `asaas`, `database` e apps.
- `resolveTenantSession`, `runWithTenant`, registry de proteção e runtime RLS.
- Webhook como fonte de estado financeiro, com filas, idempotência e reconciliação.
- DTOs Zod, mappers, serviços de domínio e testes adversariais já existentes.
- ADR de fronteiras Asaas e teste automatizado de arquitetura.

### Problemas prioritários

| Prioridade | Problema | Evidência | Risco |
|---|---|---|---|
| P0 | Estado do worktree não consolidado | 427 modificados e 36 não rastreados | Não é possível separar baseline de refatoração em andamento |
| P0 | Auditoria tenant ainda precisa ser sistemática | queries diretas e handlers heterogêneos | Vazamento ou mutação cross-tenant |
| P1 | Route handlers gordos | 140 handlers >100 linhas; 28 >300 | Regra crítica difícil de testar e revisar |
| P1 | Persistência na camada HTTP | O baseline histórico tinha 173 handlers; a auditoria atual mede 0 imports diretos, com gateways nomeados nos legados restantes | Manter extração incremental até remover os gateways de compatibilidade |
| P1 | Superfície duplicada | `finance`, `financeiro`, `cobrancas`, `contratos`, `event-contracts` | Contratos divergentes e manutenção duplicada |
| P1 | Erros HTTP inconsistentes | envelopes e códigos variam; há retorno de `error.message` | Vazamento de detalhes internos e clientes frágeis |
| P1 | Testes de rotas distribuídos de forma desigual | 41 arquivos de teste específicos para 519 handlers | Regressões em endpoints críticos |
| P2 | `packages/lib` abrangente | cerca de 125 arquivos de responsabilidades distintas | Dependências amplas e fronteiras pouco claras |
| P2 | Nomenclatura paralela | `alunos/students`, `responsaveis/responsibles`, `matriculas/enrollments` | Ownership ambíguo e duplicação potencial |
| P2 | Configuração do workspace duplicada | tarefas repetidas em `.vscode`, referências antigas a `mcp/context7` | Onboarding e execução inconsistentes |
| P2 | Descoberta insuficiente | ausência de README raiz e mapa único de módulos | Maior tempo para manutenção e onboarding |

Achados concretos para a primeira onda: `apps/web/app/api/cobrancas/[id]/route.ts`, `apps/web/app/api/matriculas/[id]/route.ts`, `apps/web/app/api/financeiro/cobrancas/[id]/route.ts`, `apps/web/app/api/events/_helpers.ts` e `packages/lib`.

## 3. Arquitetura alvo

### 3.1 Regra de dependência

```text
Route Handler/BFF
  → contexto HTTP, autenticação, DTO e resposta
  → caso de uso/serviço de aplicação
  → domínio + repositories/adapters
  → database ou integração externa
```

Regras:

1. `route.ts` não contém regra acadêmica ou financeira complexa.
2. `route.ts` não acessa Prisma diretamente, salvo allowlist temporária e justificada.
3. `packages/domain` não importa infraestrutura.
4. `packages/asaas` não conhece Alusa, tenant ou Prisma.
5. `packages/finance` é a porta única para fluxos financeiros reais.
6. Toda operação tenant-scoped recebe contexto autenticado e filtra `contaId` end-to-end.
7. Toda mutação financeira possui idempotência, auditoria, correlação e confirmação assíncrona adequada.

### 3.2 Organização alvo do web

```text
apps/web/
├── app/                         páginas e route handlers finos
├── features/<bounded-context>/  DTOs, schemas, adapters de UI e contratos HTTP
├── src/server/<bounded-context>/ casos de uso/serviços de aplicação do web
├── lib/                         somente cross-cutting real
└── components/                  apresentação reutilizável
```

Novos módulos devem escolher uma única fonte de verdade por bounded context. `features` e `src/server` podem coexistir durante a migração, mas cada contexto deve declarar explicitamente onde ficam DTO, aplicação, domínio e persistência.

### 3.3 API alvo

Não fazer renomeação em massa. Primeiro definir contratos canônicos e manter aliases compatíveis:

- `/api/auth`, `/api/public`, `/api/webhooks`, `/api/jobs`, `/api/mobile` e `/api/admin` continuam namespaces explícitos.
- Definir uma convenção única para recursos acadêmicos: alunos, responsáveis, matrículas, contratos e eventos.
- Definir uma convenção financeira: `/api/finance/*` como superfície de domínio/casos de uso; `/api/financeiro/*` e `/api/cobrancas/*` ficam como compatibilidade até serem migrados.
- Cada alias deve ter teste de contrato, telemetria de uso e plano de remoção.
- Todos os endpoints devem usar envelope de erro único: `{ error: { code, message, details? } }`.

## 4. Plano de execução

### Fase 0 — Baseline e governança

**Objetivo:** tornar o estado atual auditável.

Entregas:

- separar as alterações atuais em commits/branches coerentes, sem apagar trabalho existente;
- produzir inventário automático de rotas, imports, handlers, testes e dependências;
- criar allowlists temporárias para exceções de Prisma, nomes legados e rotas especiais;
- registrar proprietário técnico por bounded context;
- bloquear novas alterações sem teste nos fluxos críticos.

Critério de saída: baseline identificável, `git diff` revisável e relatório reproduzível por script.

### Fase 1 — Higiene do workspace

**Objetivo:** eliminar ruído e inconsistências de configuração.

Entregas:

- limpar tarefas duplicadas em `.vscode/tasks.json` e `apps/.vscode/tasks.json`;
- remover ou corrigir referências a diretórios ausentes `mcp` e `context7`;
- alinhar comandos root, `apps/web`, `apps/admin` e `apps/mobile`;
- preservar caches, builds e secrets fora do Git;
- adicionar validação de workspace, lockfile, Node/pnpm e variáveis de ambiente;
- criar README raiz curto com mapa, comandos e regras de segurança;
- separar claramente artefatos legais, assets de tickets, scripts operacionais e código.

Critério de saída: clone limpo instala, gera Prisma e executa lint/typecheck/testes documentados com comandos únicos.

### Fase 2 — Contratos HTTP e cross-cutting

**Objetivo:** uniformizar comportamento sem alterar regra de negócio.

Entregas:

- criar helpers únicos para autenticação, contexto tenant, autorização, resposta e erro;
- substituir retornos crus de `error.message` por mensagens públicas estáveis;
- padronizar códigos HTTP, envelopes, `cache-control`, `x-correlation-id` e logs estruturados;
- validar query, params, body, multipart e headers com Zod;
- adicionar limite, paginação e ordenação explícitos em listagens;
- criar testes de contrato para 401, 403, 404, 409, 422, 429 e 500.

Critério de saída: novos handlers não criam formato de resposta próprio e não expõem exceção interna.

### Fase 3 — Segurança tenant e autorização

**Objetivo:** fechar isolamento por conta antes de refactors amplos.

Entregas:

- auditar as 519 rotas por classificação: pública, sessão, admin, financeiro, mobile, cron ou webhook;
- exigir autenticação/autorização também no handler, mantendo `proxy` como camada adicional;
- centralizar resolução de `contaId`; nunca aceitar tenant selecionável livremente pelo client;
- revisar queries `findUnique`, `findFirst`, `update`, `delete`, `count`, `groupBy`, cache e logs;
- garantir filtros compostos por `contaId` em entidades tenant-scoped;
- criar matriz de testes Conta A/Conta B para leitura, alteração, exclusão, cache, jobs e suporte;
- validar produção com `DATABASE_RLS_URL` e role sem bypass;
- registrar acessos sensíveis de suporte, exportações e operações financeiras.

Critério de saída: nenhuma rota crítica sem teste negativo cross-tenant e nenhuma exceção tenant sem justificativa registrada.

### Fase 4 — Extração dos handlers críticos

**Objetivo:** reduzir risco e tamanho nas áreas de maior impacto.

Ordem:

1. `cobrancas/[id]`: separar leitura, atualização e cancelamento; mover orquestração Asaas, convergência, auditoria e política para `packages/finance`/serviços dedicados.
2. `matriculas/[id]`: separar leitura, edição, status e exclusão; mover regras de assinatura, matrícula familiar e hard delete para casos de uso.
3. `cobrancas/[id]/refund` e `undo-receive-in-cash`: consolidar comandos financeiros idempotentes.
4. `alunos/[id]`, `alunos/[id]/detalhes` e `responsaveis/[id]/overview`: separar read models, privacy e mutações.
5. demais handlers acima de 300 linhas, por risco e volume.

Cada extração deve preservar o contrato atual, incluir teste de sucesso/erro/retry/tenant e remover duplicação, sem alterar estado financeiro fora do fluxo oficial.

Critério de saída: handlers críticos com auth + parsing + chamada de caso de uso + resposta; exceções documentadas e pequenas.

### Fase 5 — Canonicalização da API

**Objetivo:** reduzir duplicidade sem quebra de consumidores.

Entregas:

- inventariar consumidores web, mobile, admin, jobs e integrações por endpoint;
- escolher canonical por bounded context e publicar matriz alias → canonical;
- criar adapters internos e redirects/deprecation headers quando aplicável;
- migrar primeiro clientes internos, depois remover aliases sem uso;
- unificar português/inglês por contexto, não por substituição mecânica;
- versionar mudanças incompatíveis por contrato, mantendo compatibilidade durante a janela de migração.

Critério de saída: cada operação possui uma implementação canônica, um contrato e um proprietário.

### Fase 6 — Pacotes e dependências

**Objetivo:** reduzir acoplamento do monorepo.

Entregas:

- decompor `packages/lib` por responsabilidade: contratos, eventos, notificações, jobs, serviços de cadastro e utilitários;
- mover regra financeira para `packages/finance`;
- mover regra acadêmica pura para `packages/domain`;
- mover repositories para `packages/database`;
- manter `shared` sem dependência de infraestrutura;
- gerar grafo de dependências e bloquear ciclos/imports proibidos no CI;
- manter `architecture-boundaries.test.ts` e ampliar a cobertura para rotas e `packages/lib`.

Critério de saída: cada pacote tem propósito único, README próprio e dependências mínimas justificadas.

### Fase 7 — Testes, observabilidade e operação

**Objetivo:** tornar a qualidade mensurável e sustentável.

Entregas:

- testes unitários de domínio e casos de uso;
- testes de rota para endpoints críticos;
- testes E2E dos fluxos aluno → matrícula → contrato → cobrança → webhook → portal;
- testes adversariais de retry, corrida, idempotência, cross-tenant e webhook inválido;
- cobertura de contratos HTTP e regras financeiras críticas;
- métricas de latência, erro, cache, fila, DLQ, reconciliação e correlation ID;
- runbooks de incidente tenant, Asaas, webhook, restore, migrations e secrets;
- staging com carga controlada antes de remover aliases ou promover migrations.

Critério de saída: pipeline reproduzível com `lint`, `typecheck`, `test`, `security:check`, migração de teste e E2E crítico.

## 5. Backlog inicial priorizado

### BLOQUEADORES

- Classificar todas as rotas e executar auditoria Conta A/B.
- Remover retornos de mensagens internas em respostas 5xx.
- Definir baseline das 427 alterações e 36 arquivos não rastreados.
- Proteger operações financeiras contra execução duplicada ou fora de webhook/reconciliação.

### ALTO

- Extrair `cobrancas/[id]` e `matriculas/[id]`.
- Criar regra CI para impedir Prisma direto em novos route handlers.
- Padronizar contexto tenant, erros, DTOs e observabilidade.
- Cobrir com testes os comandos de cobrança, estorno, recebimento, matrícula e rematrícula.
- Definir canonicalização de `finance`/`financeiro`/`cobrancas`.

### MÉDIO

- Decompor `packages/lib`.
- Resolver famílias de nomenclatura paralela.
- Limpar configurações do editor e referências de workspace.
- Criar inventário de consumidores e owners por módulo.

### MELHORIA

- Melhorar README raiz e índices de arquitetura.
- Padronizar nomes técnicos em inglês e nomes de produto em português conforme bounded context.
- Automatizar mapa de rotas, dependências, testes e exceções.

## 6. Guardrails permanentes de CI

- `pnpm lint` sem warnings novos.
- `pnpm typecheck` em todos os packages e apps.
- `pnpm test` com banco de teste explicitamente validado.
- `pnpm security:check`.
- teste de fronteiras de pacote e import graph.
- falha se novo route handler importar Prisma sem allowlist.
- falha se qualquer route handler ultrapassar 300 linhas sem uma exceção
  explícita e revisável (`pnpm audit:route-sizes`).
- falha se novo endpoint tenant-scoped não declarar proteção e teste de autorização.
- falha se resposta 5xx expuser `Error.message`, stack, token ou segredo.
- validação de migrations, cron config, env e lockfile.
- `pnpm lint:check` compara warnings por regra com o baseline versionado e
  permite somente redução ou manutenção do débito legado.

## 7. Métricas de conclusão

- 0 endpoints críticos sem autenticação/autorização explícita.
- 0 falhas conhecidas de isolamento Conta A/B.
- 0 novos imports diretos de Prisma em route handlers.
- 100% das mutações financeiras críticas com idempotência e auditoria.
- 100% dos endpoints canônicos com DTO de entrada/saída e envelope de erro.
- 0 handlers críticos acima de 300 linhas; exceções justificadas.
- 0 handlers com import direto de Prisma; redução progressiva dos handlers legados acima de 100 linhas.
- uma implementação canônica por operação e alias legado monitorado.
- pipeline completo executável a partir de clone limpo.

## 8. Sequência recomendada

```text
Baseline/owners
  → higiene do workspace
  → contratos HTTP
  → tenant/autorização
  → extração financeira e matrícula
  → canonicalização de rotas
  → decomposição de packages/lib
  → testes, carga e operação
```

Não executar renomeação em massa, migração destrutiva ou remoção de alias antes de concluir o inventário de consumidores, os testes Conta A/B e a validação dos fluxos financeiros em staging.
