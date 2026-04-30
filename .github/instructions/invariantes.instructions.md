---
applyTo: '**'
---

## Invariantes (NUNCA violar)

- Um **aluno dependente** não é `Customer` no Asaas e não possui `asaasCustomerId`.
- Toda cobrança precisa de:
  - subconta (instituição) correta
  - `customerId` do responsável financeiro
  - vínculo rastreável com matrícula/plano
- Estados financeiros (pago/vencido/cancelado/inadimplente) **não são inferidos**, apenas refletidos (preferencialmente via webhook).
- Webhooks devem ser **idempotentes** e reprocessáveis.
- Nenhuma mutação financeira (criar/cancelar/alterar cobrança) pode acontecer sem:
  - intenção explícita do fluxo
  - validação de pré-condições
  - auditoria/log com correlação