---
applyTo: '**'
---

## Webhooks: contrato e comportamento esperado

- Webhook é a confirmação oficial do Asaas.
- Processamento deve ser:
  - idempotente (mesmo evento processado N vezes = mesmo resultado)
  - tolerante a reordenação (eventos podem chegar fora de ordem)
  - tolerante a atraso (não presumir “pagou” sem evento)
- Guardar “eventId”/chave de idempotência + payload bruto para auditoria.
- Permitir reprocessamento manual/automático sem efeitos colaterais.