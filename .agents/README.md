# Agentes Alusa

Contratos canônicos de especialistas de IA para o monorepo Alusa.

## Como usar

| Ferramenta | Como invocar |
|------------|--------------|
| **Cursor** | **`alusa-orchestrator` / `#orchestrator`** (pipeline multi-agente) · Skill `alusa` / `#alusa` · `alusa-education-domain` / `#education-domain` · `core` / `#core` · `tenant` / `#tenant` · `alusa-tenant-security-auditor` / `#tenant-audit` · `alusa-prisma-data-integrity` / `#prisma-integrity` · `asaas` / `#asaas` · `asaas-client` / `#asaas-client` · `alusa-webhook-reliability` / `#webhook-reliability` · `finance-sync` / `#finance-sync` · `alusa-test-adversarial` / `#test-adversarial` · `alusa-architecture-reviewer` / `#architecture-review` · `chrome-devtools` / `#chrome-devtools` |
| **Copilot** | **`@Alusa Delivery Orchestrator`** · `@Alusa Product Context` · `@Alusa Education Domain Specialist` · `@Alusa Core` · `@Multitenancy Isolation` · `@Alusa Tenant Security Auditor` · `@Alusa Prisma Data Integrity Specialist` · `@Asaas MCP Specialist` · `@Asaas HTTP Client Specialist` · `@Alusa Webhook Reliability Specialist` · `@Financial Sync Specialist` · `@Alusa Adversarial Testing Specialist` · `@Alusa Architecture Reviewer` · `@Chrome DevTools MCP Specialist` |
| **Codex** | Skill **`$alusa-delivery-workflow`**; GPT-6 Luna é o modelo principal preferido e o seletor do usuário permanece livre; `alusa-core-worker` implementa por padrão em Luna Medium. GPT-6.1 Sol fica reservado a decisões pontuais baseadas em evidências coletadas pelo Luna. Consulte abaixo as regras de revisão por risco. |
| **Qualquer** | “Siga `.agents/alusa-orchestrator.md`” (coordenação) · `.agents/alusa.md`, `.agents/alusa-education-domain.md`, `.agents/core.md`, `.agents/tenant.md`, `.agents/alusa-tenant-security-auditor.md`, `.agents/alusa-prisma-data-integrity.md`, `.agents/asaas.md`, `.agents/asaas-client.md`, `.agents/alusa-webhook-reliability.md`, `.agents/finance-sync.md`, `.agents/alusa-test-adversarial.md`, `.agents/alusa-architecture-reviewer.md` ou `.agents/chrome-devtools.md` |

## Mapa de agentes

| ID | Arquivo | Pergunta que responde | Trigger |
|----|---------|----------------------|---------|
| **alusa-orchestrator** | [alusa-orchestrator.md](./alusa-orchestrator.md) | Qual pipeline de agentes entrega isso com segurança? | `#orchestrator`, `#delivery-pipeline`, coordenar agentes |
| **alusa** | [alusa.md](./alusa.md) | Isso faz sentido no produto? Qual domínio? | `#alusa`, escopo, visão |
| **alusa-education-domain** | [alusa-education-domain.md](./alusa-education-domain.md) | Regra acadêmica pura em `@alusa/domain`? | `#education-domain`, matrícula, turma |
| **core** | [core.md](./core.md) | Como implementar com segurança? | `#core`, dev, refactor, UI, API |
| **tenant** | [tenant.md](./tenant.md) | Está isolado no `contaId`? RLS, portal, cache | `#tenant`, RLS, cross-tenant |
| **alusa-tenant-security-auditor** | [alusa-tenant-security-auditor.md](./alusa-tenant-security-auditor.md) | Este diff vaza tenant? (review adversarial) | `#tenant-audit`, `#tenant-security`, IDOR |
| **alusa-prisma-data-integrity** | [alusa-prisma-data-integrity.md](./alusa-prisma-data-integrity.md) | Schema/migration/constraint/idempotência corretos? | `#prisma-integrity`, migration, outbox |
| **asaas** | [asaas.md](./asaas.md) | Contrato Asaas, webhook, MCP, cobrança? | `#asaas`, subconta, payment |
| **asaas-client** | [asaas-client.md](./asaas-client.md) | Função HTTP em `packages/asaas` espelha a API? | `#asaas-client`, `packages/asaas`, `AsaasHttp` |
| **alusa-webhook-reliability** | [alusa-webhook-reliability.md](./alusa-webhook-reliability.md) | Webhook idempotente, fila, DLQ, reconciliação? | `#webhook-reliability`, `WebhookAsaas`, at-least-once |
| **finance-sync** | [finance-sync.md](./finance-sync.md) | Alteração na Alusa reflete no Asaas e reconcilia? | `#finance-sync`, outbound sync, edição financeira |
| **alusa-test-adversarial** | [alusa-test-adversarial.md](./alusa-test-adversarial.md) | Testes provam falha/retry/cross-tenant? | `#test-adversarial`, webhook duplicate, race |
| **alusa-architecture-reviewer** | [alusa-architecture-reviewer.md](./alusa-architecture-reviewer.md) | Review final de camadas antes do merge? | `#architecture-review`, `#arch-review` |
| **chrome-devtools** | [chrome-devtools.md](./chrome-devtools.md) | Fluxo funciona no browser? Console, network, performance? | somente pedido explícito: `#chrome-devtools`, Chrome DevTools MCP |

## Camadas

```txt
alusa-orchestrator (coordenação — roteamento + síntese)
  → alusa (produto — o quê / por quê)
  → alusa-education-domain (regras acadêmicas puras)
  → core (implementação universal)
  → tenant | … | alusa-test-adversarial | alusa-architecture-reviewer (gate final) | …
```

## Contratos e perfis Codex

Os arquivos `.agents/*.md` são os contratos canônicos dos especialistas e permanecem a fonte de regras do projeto. Os perfis `.codex/agents/*.toml` são instruções executáveis específicas do Codex app/CLI; devem apontar para esses contratos e declarar permissões apropriadas. Além dos perfis já existentes de implementação, decisão e revisão tenant, os perfis read-only de Prisma/data integrity, webhook reliability, testes adversariais e architecture reviewer atendem aos gates necessários, sem perfis para cada especialista.

| Contrato canônico | Perfil executável Codex |
|-------------------|------------------------|
| `alusa-prisma-data-integrity` | `alusa-prisma-reviewer` |
| `alusa-webhook-reliability` | `alusa-webhook-reviewer` |
| `alusa-test-adversarial` | `alusa-adversarial-reviewer` |
| `alusa-architecture-reviewer` | `alusa-architecture-reviewer` |
| `alusa-tenant-security-auditor` | `alusa-tenant-reviewer` |

No Codex, `.codex/config.toml` ativa agentes com `[agents] enabled = true`, usa GPT-6 Luna Medium como subagente padrão e limita threads spawned por sessão com `max_concurrent_threads_per_session = 3`.

- GPT-6 Luna é o modelo principal preferido, sem fixar o modelo da sessão no projeto; o usuário pode escolher o modelo e esforço. O coordenador não implementa código de produto; alterações são delegadas a um único `alusa-core-worker`, Luna Medium por padrão, com esforço maior quando necessário ou solicitado.
- Tarefa trivial/pequena: somente o worker, sem advisor, especialista ou revisor. Trabalho normal/material: no máximo um revisor read-only mais pertinente; gate de arquitetura somente se materialidade/risco exigir. Mudança crítica tenant/financeiro/webhook/schema: mínimo de revisões exigido pelos contratos, paralelizando as independentes; arquitetura por último quando exigida.
- Revisores usam GPT-6 Luna High, permanecem read-only e retornam findings acionáveis.
- `alusa-decision-advisor` é read-only e usa GPT-6.1 Sol em esforço baixo ou médio apenas para decisão de alto impacto. O Luna coleta contexto e evidências primeiro; o Sol recebe um brief delimitado e não investiga o repositório.
- Em tarefas técnicas Luna Extra High que dependam de serviço/framework externo, consultar o MCP oficial pertinente (Stripe, Asaas, Vercel, Neon ou Context7), apenas para leitura; usar as evidências recuperadas e explicitar lacunas, sem inventar comportamento.
- Delegações recebem escopo/arquivos exatos e apenas contratos pertinentes. Leia somente código relacionado e devolva síntese curta, sem logs ou diffs extensos.

`agent.multi_agent.enabled` e `max_concurrent_subagents` das páginas Agents API configuram sessões da Agents API e **não** são opções do Codex app/CLI. Para Codex, consulte [Subagents](https://developers.openai.com/codex/subagents/) e a [referência de configuração](https://developers.openai.com/codex/config-reference/).

## Hierarquia de fonte de verdade

1. Código + testes
2. `AGENTS.md`, `.github/instructions/`, `.agents/`
3. `packages/*`, `apps/web/features/*`
4. MCP Asaas (contrato externo)

## Relacionados

- Regras universais de código: [AGENTS.md](../AGENTS.md) · [core.md](./core.md)
- Coordenação multi-agente: [alusa-orchestrator.md](./alusa-orchestrator.md)
- Isolamento tenant: [tenant.md](./tenant.md) · Auditoria adversarial: [alusa-tenant-security-auditor.md](./alusa-tenant-security-auditor.md) · Persistência: [alusa-prisma-data-integrity.md](./alusa-prisma-data-integrity.md) · Testes: [alusa-test-adversarial.md](./alusa-test-adversarial.md) · Review final: [alusa-architecture-reviewer.md](./alusa-architecture-reviewer.md)
- Integração Asaas: [asaas.md](./asaas.md) · Cliente HTTP: [asaas-client.md](./asaas-client.md) · Webhooks: [alusa-webhook-reliability.md](./alusa-webhook-reliability.md)
- Sincronização financeira outbound: [finance-sync.md](./finance-sync.md)
- Automação e auditoria no navegador: [chrome-devtools.md](./chrome-devtools.md)
- Skills Cursor: `.cursor/skills/`
- Workflow Codex: `.agents/skills/alusa-delivery-workflow/` · configuração e subagentes: `.codex/`
- Adaptadores Copilot: `.github/agents/`
