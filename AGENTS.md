# AGENTS.md — Alusa

A Alusa é um ERP Educacional multi-tenant, desenvolvido para centralizar a gestão administrativa, acadêmica, operacional e financeira de escolas, cursos e instituições de ensino.

A entidade `Conta` é o tenant principal da plataforma. Toda implementação deve preservar isolamento, segurança, consistência financeira e manutenibilidade do monorepo.

## Agentes especializados

Contratos canônicos em **`.agents/`**:

| ID | Arquivo | Uso |
|----|---------|-----|
| **alusa-orchestrator** | [`.agents/alusa-orchestrator.md`](.agents/alusa-orchestrator.md) | Coordenação multi-agente, pipeline, Delivery Brief — `#orchestrator` |
| **alusa** | [`.agents/alusa.md`](.agents/alusa.md) | Produto, escopo, visão, objetivo — `#alusa` |
| **alusa-education-domain** | [`.agents/alusa-education-domain.md`](.agents/alusa-education-domain.md) | Domínio educacional puro `packages/domain` — `#education-domain` |
| **core** | [`.agents/core.md`](.agents/core.md) | Implementação segura, UI, camadas, testes, cache — `#core` |
| **tenant** | [`.agents/tenant.md`](.agents/tenant.md) | Isolamento multitenancy, RLS, `contaId` — `#tenant` |
| **alusa-tenant-security-auditor** | [`.agents/alusa-tenant-security-auditor.md`](.agents/alusa-tenant-security-auditor.md) | Revisão adversarial cross-tenant — `#tenant-audit` |
| **alusa-prisma-data-integrity** | [`.agents/alusa-prisma-data-integrity.md`](.agents/alusa-prisma-data-integrity.md) | Schema Prisma, migrations, constraints, idempotência — `#prisma-integrity` |
| **asaas** | [`.agents/asaas.md`](.agents/asaas.md) | API Asaas, webhooks, MCP, cobranças — `#asaas` |
| **asaas-client** | [`.agents/asaas-client.md`](.agents/asaas-client.md) | Cliente HTTP tipado `packages/asaas` — `#asaas-client` |
| **alusa-webhook-reliability** | [`.agents/alusa-webhook-reliability.md`](.agents/alusa-webhook-reliability.md) | Webhooks idempotentes, fila, DLQ, reconciliação — `#webhook-reliability` |
| **finance-sync** | [`.agents/finance-sync.md`](.agents/finance-sync.md) | Sincronização financeira outbound Alusa → Asaas com reconciliação — `#finance-sync` |
| **alusa-test-adversarial** | [`.agents/alusa-test-adversarial.md`](.agents/alusa-test-adversarial.md) | Testes adversariais (retry, cross-tenant, webhook) — `#test-adversarial` |
| **alusa-architecture-reviewer** | [`.agents/alusa-architecture-reviewer.md`](.agents/alusa-architecture-reviewer.md) | Review final de arquitetura antes do merge — `#architecture-review` |
| **chrome-devtools** | [`.agents/chrome-devtools.md`](.agents/chrome-devtools.md) | Automação/auditoria com Chrome DevTools MCP — somente uso explícito `#chrome-devtools` |
| *(índice)* | [`.agents/README.md`](.agents/README.md) | Mapa e roteamento de agentes |

Este arquivo (**`AGENTS.md`**) espelha as **regras universais** do agente **core**. Contrato operacional completo (UI, fluxo, checklists): [`.agents/core.md`](.agents/core.md). Skills Cursor: `.cursor/skills/`.

## Operação de deploy

- Para mudanças de build, CI, Vercel, migrations ou publicação em produção, seguir o [runbook de deploy](docs/runbooks/deploy-production.md).
- Para mudanças comuns de baixo risco, usar o fast path: checks locais direcionados servem para encontrar bugs; revisar o diff, criar commit e enviar diretamente para `main`; acompanhar o deployment Vercel até `Ready` e confirmar SHA e aliases. Não esperar full suite, review humano nem CI remoto flaky ou não relacionado para publicar.
- Bloquear o push quando um check relevante revelar falha reproduzível ou o diff mostrar bug/regressão clara; corrigir antes de publicar. Não mascarar resultados nem pular testes específicos como atalho.
- O estado verificado da proteção classic de `main` permite push direto sem PR, approval ou status check obrigatório. Permanecem `enforce_admins`, histórico linear obrigatório, proibição de force push e exclusão, e resolução de conversas obrigatória; não contornar essas proteções.
- PR e aprovação humana não são caminho nem gate do fast path. Se o GitHub rejeitar um push no futuro, verificar se as configurações mudaram e qual regra aplicável bloqueou; alterar settings somente mediante autorização explícita.
- Não considerar um commit enviado para `main` como publicado até confirmar a implantação `Ready`, o SHA esperado e os aliases de produção.
- Reservar validação adicional para mudanças materiais ou de risco elevado, conforme o runbook. Migrações e operações de dados com potencial de dano irreversível exigem validação segura antes da execução; não tratar essas salvaguardas como burocracia opcional.
- Em falhas de build, reproduzir o comando real da Vercel e corrigir a causa sem relaxar TypeScript, testes, autenticação ou validações.
- Toda migration versionada exigida por uma mudança deve ser testada em banco descartável/branch Neon e aplicada à branch/database Neon de produção como etapa do release; migration local não basta. Usar `prisma migrate deploy`, `DIRECT_URL` não pooled, confirmar target de produção e `prisma migrate status`.
- Considerar o deploy Vercel automático após push: só aplicar antes do push migrations backwards-compatible; para incompatíveis/destrutivas, usar expand/contract ou deploy em fases. Falha de migration impede publicar código que dependa dela. Não executar migration em produção sem validação e confirmação explícitas do target.
- Migrations e backfills devem ser seguros, escopados, idempotentes e validados antes da promoção da aplicação.

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
- Seguir as convenções HTTP em [docs/architecture/api-http-conventions.md](docs/architecture/api-http-conventions.md): método compatível com a operação, status coerente com o estado real e código de erro estável.
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
- Em mudanças de código, usar testes/typecheck relacionados como checks direcionados para encontrar bugs; falhas reproduzíveis relevantes devem ser corrigidas. Não aguardar CI remoto flaky/não relacionado como gate do fast path.
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

### Meta Ads

- Para consultas e operações de anúncios, priorizar o MCP oficial da Meta (`meta-ads`, `https://mcp.facebook.com/ads`) quando autenticado e com ferramentas disponíveis; usar a CLI oficial `meta-ads` como alternativa controlada.
- A configuração do servidor ou o retorno de login não comprovam acesso funcional. Validar com uma consulta autenticada somente de leitura antes de declarar a integração pronta.
- Manter `default_tools_approval_mode = "prompt"` no servidor MCP Meta Ads; não liberar chamadas automaticamente.
- Começar somente com leitura. Não criar, editar, ativar, pausar, excluir anúncios/campanhas, alterar públicos ou mudar orçamento sem aprovação explícita para a operação específica.
- Antes de qualquer operação futura, confirmar a conta, o ID, a moeda e o fuso horário; não escolher arbitrariamente entre várias contas.
- Nunca pedir ou registrar tokens no chat, em logs, neste arquivo, em `.env` ou no repositório. Usar armazenamento seguro do sistema e não reutilizar automaticamente token MCP na CLI sem validar compatibilidade.
- Não usar conectores de terceiros para Meta Ads sem autorização explícita.
- Registrar erros de autenticação e limitações sem inventar resultados ou afirmar acesso que não foi testado.

### Convenções de implementação

- Usar TypeScript de forma estrita e segura.
- Usar Zod para validação de dados quando aplicável.
- Usar Prisma respeitando transações quando houver consistência entre múltiplas escritas.
- Usar nomes claros, preferencialmente em inglês para arquivos, funções, DTOs e módulos técnicos.
- Agrupar features web por domínio em inglês (`students`, `responsibles`, `enrollments`, `finance`, `employees`, `lessons`); criar `components`, `hooks`, `services` e `dtos` dentro do domínio apenas quando necessários.
- Manter UI exclusiva de uma feature em `apps/web/features/<domain>/components`, UI compartilhada entre features em `apps/web/components/shared` e UI compartilhada entre apps em `packages/ui`.
- Preservar URLs públicas existentes em português; renomear URLs exige migração planejada com redirects de compatibilidade.
- Manter testes unitários em `apps/web/tests/unit`, testes de integração em `apps/web/tests/integration` e testes E2E em `apps/web/e2e`.
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

<!-- BEGIN AWS Agent Toolkit rules -->

# AWS Guidance for the new AWS experience

This user has signed up for the new AWS experience. This experience lets you sign into AWS using a social provider and requires the following additional context.

Where this guidance conflicts with the project's own instructions, the project's instructions take precedence.

## Context

### Terminology:

- Say "project" instead of "account" — a project contains an AWS account and settings for sharing with other collaborators
- Say "team member" instead of "IAM user" — users are invited by email, not created or federated in IAM
- Say "AWS Settings" when referring to management tasks at [settings.aws.com](https://settings.aws.com/) (project management, billing, team members, spend limits). Users view their actual AWS resources in the AWS Management Console.
- Say "selected Region" when referring to the user's Region — not "home Region"
- The user has a managed IAM experience. This includes a managed service control policies (SCP) and resource control policies (RCP) that govern the use of AWS. They will still need to use IAM to create policies to let services work with each other. If there are questions about the SCPs or RCPs, go to the documentation at https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html

### Constraints:

- All projects share a single AWS Region determined by the user's contact address. Resources cannot be created in other Regions
- When developing:
  - MUST create all Regional resources in the project's assigned Region
  - You CAN create AWS WAF and Cloudwatch Logs resources in us-east-1 when there are global resources (like a global WAF instance) that require a connection to dependencies in us-east-1. You should not use these for any other reason, because resources in the selected Region will provide lower cost (due to no cross-Region traffic), increased availability (due to no cross-Region traffic), and easier manageability (due to not needing to look in another Region). When you need to do an inventory of resources, you need to look in both the selected Region and us-east-1 for Cloudwatch Logs or WAF resources.
  - MUST NOT attempt to create Lambda, API Gateway, or other Regional resources in any other Region
  - MUST direct users to confirm their Region in AWS Settings > View all projects > Overview > Additional Info > Region. If the user cannot confirm their Region, check in ~/.aws/config
  - MUST NOT use Lambda@Edge — excluded from both Lambda and CloudFront
  - MUST NOT use CloudFormation StackSets — no multi-account or multi-Region deployments
  - MUST NOT attempt cross-Region actions — no cross-Region replication for DynamoDB/S3/RDS, no multi-Region KMS keys
  - MUST NOT use Route 53 cross-Region routing — geolocation, latency-based, and failover routing policies are not available
  - CloudFront is a global service and its actions ARE allowed in `us-east-1`. A user can create a CloudFront distribution pointing to their project-region Lambda function URL or API Gateway. However, Lambda and API Gateway themselves MUST NOT be created in `us-east-1` — they must be in the project Region.
  - Reduced availability in `eu-north-1` specifically: Amazon Rekognition, Amazon Textract, Amazon Personalize, AWS App Runner are not available in that Region.
- IAM permissions for human access are managed by AWS. Don't assign roles to team members unless absolutely necessary
- The user may have a spend limit if they are on the paid plan. The limit that pauses their project if it's exceeded. If resources suddenly become inaccessible, ask if they have a spend limit configured. Only project owners can modify a spend limit.
- When developing:
  - MUST ask about spend limit status if the user reports sudden "Access Denied" errors on operations that previously worked
  - MUST direct users to check spend status in AWS Settings > Billing
  - MUST check if a user has upgraded their account to the paid plan
  - MUST ask the user if they want to clean up the successfully created resources or keep them to reduce cost
- The user sets up billing, creates spend limits, and retrieves and pays invoices in AWS Settings. The user creates budgets and optimizes their costs in the AWS Billing and Cost Management console
- Not all AWS services are available. If a service isn't working, do the following:
  1. Run the command `aws freetier get-account-plan-state`
  2. If accountPlanType": "FREE", check the [Free Tier supported services list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#supported-services-free-tier) next,
  3. If accountPlanType": "PAID", check the [Paid Tier supported services list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#supported-services-paid-plan).
  4. If neither list shows the service, check the [Not supported for this experience list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#unsupported-services). The user will need to activate advanced features to access this service.
- Users can activate advanced AWS services and capabilities for their account.
- For any AWS task or question — building, configuring, migrating, debugging, or operating a service, writing SDK code, authoring CDK/CloudFormation, or answering how a service works — first call `aws___search_documentation` with topic `agent_skills` and load the matching skill with `aws___retrieve_skill`. Do this even when you believe you know the answer: skills carry current service behavior that your training may not. Prefer the skill's guidance over general knowledge. Skip it only for work that does not involve AWS.

### Help level

- help_level (required): LOW, MEDIUM, or HIGH. While a user is building, you MUST ask the user: "How much guidance would you like from me? Low (I only flag security risks), medium (I ask a couple of clarifying questions if something seems off), or high (I explain what I'm doing, suggest alternatives, and flag best practices)."

You CAN update this rule file to save a user's help_level.

Constraints for each level:

**LOW:**

- MUST follow all constraints in this context file
- MUST execute the user’s request without modification
- MUST NOT ask clarifying questions unless the action would create a security vulnerability
- MUST NOT suggest alternatives or improvements

**MEDIUM:**

- MUST execute the user's request
- MAY ask up to two clarifying questions per task if the request has an ambiguity or a potential issue
- MUST NOT repeat a question or suggestion the user has already dismissed
- MUST NOT explain trade-offs or alternatives unless the user asks

**HIGH:**

- MUST explain what each step does and why before executing it
- MUST suggest alternatives when a better approach exists
- MUST flag best practices and explain trade-offs
- MUST still execute the user's choice if they disagree with a suggestion

<!-- END AWS Agent Toolkit rules -->
