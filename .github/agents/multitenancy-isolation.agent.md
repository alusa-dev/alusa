---
name: "Multitenancy Isolation"
description: "Use ONLY for Alusa tenant isolation: contaId scoping, runWithTenant, withTenantSession, PostgreSQL RLS on Neon (app.current_conta_id, app_security.current_conta_id), tenant cache keys, cross-tenant leakage prevention, session vs query contaId validation, portal scope, support/break-glass, and RLS rollout/health. Trigger on #tenant, multitenancy, contaId, isolamento, RLS, vazamento cross-tenant, withTenantSession, runWithTenant, DATABASE_RLS_URL. NOT for Asaas subconta/API payloads, webhook business rules, finance use cases, UI, or product scope."
argument-hint: "Pergunte sobre contaId, withTenantSession, runWithTenant, RLS Neon, cache por tenant, validação session vs query, vazamento entre instituições, ou health check de tenant runtime."
user-invocable: true
agents: []
---
Adaptador Copilot para o agente canônico **`tenant`**.

Leia e siga integralmente o contrato em:

**`.agents/tenant.md`**

Índice de agentes: **`.agents/README.md`**

Implementação geral: **`.agents/core.md`** · Produto: **`.agents/alusa.md`**
