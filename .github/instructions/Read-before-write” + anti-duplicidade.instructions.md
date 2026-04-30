---
applyTo: '**'
---

## Padrão obrigatório para integração externa (Asaas/MCP)

Antes de qualquer POST/PUT/DELETE:
1) Fazer GET/list para confirmar se o recurso já existe.
2) Se existir, preferir reaproveitar/atualizar em vez de criar novo.
3) Sempre proteger contra duplicidade (idempotência lógica):
   - mesma matrícula + mesmo plano + mesmo período ⇒ não criar cobrança duplicada
4) Após mutação, confirmar via GET e persistir IDs externos.