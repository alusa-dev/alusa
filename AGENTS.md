# AGENTS.md — Alusa

A Alusa é um ERP Educacional multi-tenant, desenvolvido para centralizar a gestão administrativa, acadêmica, operacional e financeira de escolas, cursos e instituições de ensino.

A entidade `Conta` é o tenant principal da plataforma. Toda implementação deve preservar isolamento, segurança, consistência financeira e manutenibilidade do monorepo.

## Agentes especializados

Contratos canônicos em **`.agents/`**:

| ID | Arquivo | Uso |
|----|---------|-----|
| **alusa** | [`.agents/alusa.md`](.agents/alusa.md) | Produto, escopo, visão, objetivo — `#alusa` |
| **core** | [`.agents/core.md`](.agents/core.md) | Implementação segura, UI, camadas, testes, cache — `#core` |
| **tenant** | [`.agents/tenant.md`](.agents/tenant.md) | Isolamento multitenancy, RLS, `contaId` — `#tenant` |
| **asaas** | [`.agents/asaas.md`](.agents/asaas.md) | API Asaas, webhooks, MCP, cobranças — `#asaas` |
| *(índice)* | [`.agents/README.md`](.agents/README.md) | Mapa e roteamento de agentes |

Este arquivo (**`AGENTS.md`**) espelha as **regras universais** do agente **core**. Contrato operacional completo (UI, fluxo, checklists): [`.agents/core.md`](.agents/core.md). Skills Cursor: `.cursor/skills/`.

## Regras universais obrigatórias

### Produto e domínio

- Tratar a Alusa sempre como um ERP Educacional multi-tenant, não como SaaS genérico, CRM genérico ou sistema financeiro isolado.
- Considerar como fluxo principal do produto: cadastro de aluno/responsável → matrícula/rematrícula → contrato → cobrança/assinatura/parcelamento → pagamento → reconciliação financeira → portal do responsável/aluno.
- Não criar funcionalidades desconectadas do contexto educacional da Alusa.
- Preservar regras de domínio acadêmico em camadas apropriadas, evitando lógica crítica diretamente em componentes ou rotas HTTP.

### Multi-tenancy e segurança

- Sempre preservar isolamento por `contaId`.
- Toda entidade tenant-scoped deve ser criada, consultada, atualizada e removida dentro do contexto da `Conta`.
- Nunca permitir acesso cruzado entre contas.
- Toda query sensível deve filtrar por `contaId`, salvo entidades explicitamente globais e justificadas.
- Não confiar em `contaId` vindo livremente do client sem validação de permissão.
- Validar se o usuário autenticado pertence à conta antes de executar operações protegidas.
- Não expor dados financeiros, acadêmicos ou pessoais entre tenants.
- Evitar `unique` global quando a regra de negócio deveria ser única por conta.
- Preferir índices compostos iniciando por `contaId` quando a consulta for tenant-scoped.

### Arquitetura e organização

- Respeitar a separação entre interface, API, casos de uso, domínio, banco e integrações externas.
- `apps/web` deve concentrar a aplicação Next.js, telas, route handlers, componentes, hooks e integração com a UI.
- Regras reutilizáveis e críticas devem ficar em packages internos, não espalhadas em telas.
- Regras puras de domínio devem ficar em `packages/domain`.
- Casos de uso financeiros devem ficar em `packages/finance`.
- Cliente HTTP e contratos de integração com Asaas devem ficar em `packages/asaas` ou `packages/asaas-gateway`.
- Fronteiras de camada: [docs/adr-asaas-layer-boundaries.md](docs/adr-asaas-layer-boundaries.md).
- Serviços compartilhados, schemas e utilitários devem ficar em `packages/lib` ou `packages/shared`, conforme responsabilidade.
- Utilitários de banco e Prisma devem ficar em `packages/database`.
- Componentes reutilizáveis de interface devem ficar em `packages/ui`.
- Não criar acoplamento desnecessário entre `apps/web` e regras internas de domínio ou financeiro.
- Não transformar `packages/lib` em uma pasta genérica para qualquer coisa; manter responsabilidades claras.
- Evitar duplicação de clients, serviços, helpers e regras já existentes.
- Antes de criar novo arquivo, função, rota ou pacote, verificar se já existe algo equivalente.

### Financeiro e Asaas

- A integração financeira white label com Asaas é parte central da Alusa.
- Cada escola/conta da Alusa deve operar com sua própria subconta Asaas quando aplicável.
- A escola não deve depender da interface do Asaas para operar rotinas financeiras comuns.
- Webhooks do Asaas são a fonte principal de mudança de estado financeiro.
- Telas devem ler estado local, read models ou dados persistidos na Alusa.
- Consultas diretas ao Asaas devem ser usadas principalmente para preflight, reconciliação, verificação, documentos oficiais ou correção de divergências.
- Não alterar estado financeiro crítico apenas por ação de tela sem considerar webhook, idempotência e reconciliação.
- Toda rotina financeira relevante deve considerar idempotência.
- Toda rotina financeira relevante deve considerar logs, auditoria, rastreabilidade e `correlationId` quando aplicável.
- Não duplicar cobranças, assinaturas, parcelamentos, customers ou eventos financeiros em caso de retry.
- Webhooks devem ser tratados de forma resiliente, com validação, persistência, processamento seguro e tolerância a falhas.
- Falhas em integrações financeiras devem ser registradas de forma auditável.
- Não expor API keys, tokens, segredos ou credenciais Asaas no client.
- Dados sensíveis de integração devem ser armazenados de forma segura.

### Next.js, APIs e validação

- Route Handlers e APIs internas devem validar entrada com Zod quando aplicável.
- Não confiar em payload recebido do client sem validação.
- Separar DTOs, schemas de entrada, casos de uso e resposta HTTP.
- Route Handlers não devem conter regra de negócio pesada.
- Route Handlers devem autenticar usuário e validar acesso à `Conta`.
- Erros devem ser tratados com respostas consistentes e sem vazamento de dados sensíveis.
- Não retornar stack trace, tokens, segredos ou detalhes internos para o client.
- APIs que executam ações críticas devem considerar auditoria, permissão e idempotência.

### Banco, Prisma e migrations

- Alterações no Prisma devem preservar integridade multi-tenant.
- Toda nova tabela tenant-scoped deve ter `contaId`, relação com `Conta` e índices adequados.
- Evitar migrations destrutivas sem plano claro de migração.
- Preferir migrações seguras: adicionar campo nullable, fazer backfill, depois aplicar constraint quando necessário.
- Não remover campos, enums ou relações usados em produção sem análise de impacto.
- Não usar cascade delete em entidades financeiras, acadêmicas ou auditáveis sem justificativa forte.
- Preservar histórico financeiro, acadêmico e operacional sempre que necessário.
- Queries críticas devem considerar performance, paginação e índices.

### Autenticação, autorização e permissões

- Preservar o uso de NextAuth com credentials/JWT conforme arquitetura atual.
- Sessão/JWT deve carregar somente dados necessários.
- Permissões devem considerar usuário, role, conta ativa e vínculo com a conta.
- Não assumir que usuário autenticado pode acessar qualquer `contaId`.
- Operações administrativas devem validar papel/permissão explicitamente.
- Alterações em autenticação devem ser feitas com cuidado extra e testes.
- Não enfraquecer autenticação, autorização ou validação para “resolver build” ou acelerar implementação.

### Frontend e UI

- Componentes React não devem conter regra crítica financeira ou acadêmica.
- Componentes devem orquestrar UI, estado visual e chamadas para APIs/casos de uso.
- Formulários devem validar dados antes do envio e lidar com loading, erro, sucesso e estado vazio.
- Evitar componentes gigantes com muitas responsabilidades.
- Extrair hooks, subcomponentes, adapters e helpers quando uma tela crescer demais.
- Preservar acessibilidade básica, clareza visual e feedback ao usuário.
- Não quebrar fluxos existentes de matrícula, financeiro, contratos, portal ou administração ao alterar UI.

### Testes e qualidade

- Toda alteração relevante deve incluir ou ajustar testes.
- Regras puras de domínio devem ter testes unitários com Vitest.
- Casos financeiros devem ter testes cobrindo sucesso, erro, retry, idempotência e isolamento por `contaId` quando aplicável.
- Fluxos críticos devem ter cobertura E2E com Playwright quando fizer sentido.
- Não remover testes para fazer a implementação passar.
- Não mascarar falhas com `skip`, `only`, mocks frágeis ou relaxamento de validação sem justificativa.
- Antes de concluir uma tarefa, rodar pelo menos os testes/typecheck relacionados ao escopo alterado.
- Se não for possível rodar testes, informar claramente o motivo e o risco.

### Confiabilidade e prevenção de regressão

- Não criar gambiarras para contornar erro sem entender a causa.
- Não adicionar `eslint-disable`, `ts-ignore`, `any` ou casts inseguros sem justificativa forte e localizada.
- Não relaxar TypeScript, Zod, autenticação ou validações para esconder inconsistências.
- Preservar compatibilidade com fluxos existentes.
- Toda correção deve atacar a causa raiz quando possível.
- Toda alteração em área crítica deve avaliar impacto em matrícula, cobrança, contrato, portal, webhooks e reconciliação.
- Evitar mudanças amplas sem necessidade.
- Preferir alterações pequenas, explícitas, testáveis e reversíveis.

### Observabilidade, auditoria e operações

- Ações críticas devem gerar logs úteis, sem expor dados sensíveis.
- Operações financeiras e administrativas relevantes devem ser auditáveis.
- Falhas de integração externa devem ser rastreáveis.
- Jobs, webhooks e rotinas assíncronas devem considerar retry, idempotência e concorrência.
- Não depender apenas de estado em memória para processos críticos.
- Sempre considerar comportamento em produção, não apenas em ambiente local.

### Convenções de implementação

- Usar TypeScript de forma estrita e segura.
- Usar Zod para validação de dados quando aplicável.
- Usar Prisma respeitando transações quando houver consistência entre múltiplas escritas.
- Usar nomes claros, preferencialmente em inglês para arquivos, funções, DTOs e módulos técnicos.
- Não inventar tabelas, rotas, funções, packages ou contratos como se já existissem.
- Quando algo depender do código real, inspecionar o código antes de propor alteração.
- Reutilizar padrões existentes do repositório.
- Manter o monorepo organizado, sem acoplamento excessivo entre app e packages.

### Antes de implementar

- Entender qual fluxo da Alusa será afetado.
- Identificar se a mudança pertence à UI, API, domínio, financeiro, banco ou integração externa.
- Verificar se já existe implementação relacionada.
- Avaliar impacto multi-tenant.
- Avaliar impacto financeiro, acadêmico e operacional.
- Planejar a menor alteração segura.
- Definir quais testes precisam ser criados ou atualizados.

### Ao finalizar

- Garantir que a alteração respeita `contaId`.
- Garantir que não houve vazamento de regra crítica para camada errada.
- Garantir que validações necessárias foram adicionadas.
- Garantir que estados financeiros dependentes de webhook não foram alterados indevidamente.
- Garantir que testes relevantes foram adicionados ou atualizados.
- Informar comandos executados e resultados.
- Informar riscos restantes, se houver.

## Princípio final

A Alusa deve evoluir com segurança, previsibilidade e isolamento multi-tenant.  
Toda implementação deve proteger a integridade acadêmica, financeira e operacional das escolas que usam a plataforma.
