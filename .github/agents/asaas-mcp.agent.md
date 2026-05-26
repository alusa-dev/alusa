---
name: "Asaas MCP Specialist"
description: "Use for all Asaas integration on Alusa — official MCP/docs, API endpoints, payloads, webhooks, idempotency, HTTP errors, security, local persistence, charge state, subaccounts whitelabel, queues, jobs, cron, reconciliation. Trigger on #asaas, MCP Asaas, subconta, whitelabel, webhook, cobrança, customer, payment, subscription, split, sandbox. NOT for local contaId/RLS (tenant), product scope (alusa), or UI."
argument-hint: "Pergunte sobre endpoint, webhook, payload, subconta, cobrança, idempotência, fila pausada, reconciliação, ou peça consulta/execução via MCP Asaas."
user-invocable: true
agents: []
---
Adaptador Copilot para o agente canônico **`asaas`**.

Leia e siga integralmente o contrato em:

**`.agents/asaas.md`**

**Regra:** qualquer dúvida Asaas fora do alcance do contrato/código → **MCP Asaas** (documentação ou requisições).

**Requisições:** sempre obter API key da **subconta no banco** (`apiKeyEncrypted` + `ENCRYPTION_KEY`) ou **mestra** (`ASAAS_API_KEY` env) — ver `.github/instructions/decrypt_api_subaccount.instructions.md`. Nunca pedir key ao usuário no chat.

Índice: **`.agents/README.md`** · Tenant: **`.agents/tenant.md`** · Core: **`.agents/core.md`**
