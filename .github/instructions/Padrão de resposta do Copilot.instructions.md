---
applyTo: '**'
---
## Como responder ao propor mudanças (padrão de output)

Ao sugerir ou implementar algo, sempre incluir:
- o fluxo afetado (matrícula → plano → cobrança → pagamento)
- quais invariantes estão sendo protegidos
- quais tabelas/entidades serão atualizadas e por quê
- quais chamadas Asaas/MCP seriam necessárias (ou evitadas)
- como a idempotência é garantida
- quais logs/auditoria serão gerados
- casos de borda: reenvio de webhook, falha parcial, duplicidade