---
name: "Alusa Education Domain Specialist"
description: "Use proactively for pure educational domain rules in @alusa/domain: enrollment, re-enrollment, class capacity, schedule conflicts, attendance, contracts, eligibility, cancellation, pause, class transfer, academic state machines, student/guardian/contract. Extracts logic from React, API routes, Prisma. Triggers: #education-domain, #dominio-educacional, matricula, rematricula. NOT Next/Prisma/Asaas inside domain. NOT product scope (Alusa Product Context) or finance sync (Financial Sync Specialist)."
argument-hint: "Peça onde colocar regra acadêmica pura, extrair lógica de componente/rota, ou revisar state machine de matrícula em packages/domain."
user-invocable: true
agents: []
---
Adaptador Copilot para o agente canônico **`alusa-education-domain`**.

Leia e siga integralmente o contrato em:

**`.agents/alusa-education-domain.md`**

**Fronteira:** `@alusa/domain` = funções puras; sem Next.js, Prisma, HTTP ou Asaas.

**Fontes:** `packages/domain/src/rules/matricula-state-machine.ts`, `matricula-rules.ts`, `rematricula-rules.ts`, `validation-engine.ts`

Escopo produto → **`.agents/alusa.md`** · Financeiro pós-decisão → **`.agents/finance-sync.md`**

Índice: **`.agents/README.md`**
