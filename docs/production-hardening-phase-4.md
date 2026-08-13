# Hardening de produção — Fase 4

## Entrega

A Fase 4 implementa uma máquina explícita de estados para pagamentos Asaas, usada pelo processamento de webhook e pela reconciliação. O objetivo é impedir regressões causadas por eventos atrasados, mantendo estornos, chargebacks e a reversão oficial de chargeback possíveis.

## Componentes

- `packages/finance/src/state-machine/payment-state-machine.ts`: matriz e decisões puras para `Cobranca` e `Charge`.
- `packages/finance/src/state-machine/payment-state-transition.service.ts`: histórico append-only, deduplicado por tenant, entidade e origem.
- `packages/finance/src/webhooks/payment-webhook-handler.ts`: aplicação central dos estados, snapshots do provider, versão e auditoria.
- `packages/finance/src/use-cases/apply-provider-payment-snapshot.ts`: reconciliação reaplicada pelo mesmo pipeline do webhook.
- `packages/finance/src/webhooks/asaas-webhook-handler.server.ts`: preserva `eventId` e `dateCreated` do Asaas.
- `prisma/migrations/20260813220000_phase_4_payment_state_machine`: persistência das dimensões separadas e do histórico.

## Matriz resumida

| Origem/evento | Estado local | Resultado |
| --- | --- | --- |
| Confirmação/recebimento | Aberto → `PAGO` | Aplica e incrementa `version` |
| Evento antigo (`OVERDUE`, `PENDING`) após pagamento | `PAGO` | `NOOP`; mantém estado local |
| `PAYMENT_RECEIVED_IN_CASH_UNDONE` | `PAGO` → aberto/atrasado | Aplica somente pela reversão explícita |
| Reembolso/chargeback | Pago → estornado total/parcial | Aplica e mantém efeitos financeiros idempotentes |
| `PAYMENT_RESTORED` | Cancelado → aberto | Aplica; estornado comum continua bloqueado |
| Confirmação após `AWAITING_CHARGEBACK_REVERSAL` | Estornado → `PAGO` | Aplica a reversão oficial do provider |
| Aresta inválida recebida por webhook | Qualquer | `NOOP`, snapshot e trilha preservados |
| Aresta inválida descoberta em reconciliação | Qualquer | `RECONCILE`/`DIVERGENT`, sem forçar regressão |

O histórico não é usado como autorização para alterar outro tenant: toda chave e toda gravação carregam `contaId`.

## Estado separado persistido

`Cobranca` e `Charge` agora possuem:

- `providerStatus`: último status monotônico conhecido do Asaas;
- `processingStatus`: estado operacional do processamento;
- `reconciliationStatus`: `UNKNOWN`, `IN_SYNC` ou `DIVERGENT`;
- `providerUpdatedAt`, `lastWebhookAt`, `lastProviderCheckAt` e `lastReconciledAt`;
- `lastAppliedEventId` para rastreabilidade do último evento aplicado;
- `localStateUpdatedAt` e `version` para controle de evolução local.

`FinancePaymentStateTransition` registra estado anterior, estado posterior, decisão, motivo, origem, evento, horário do provider, versão local, `correlationId` e metadata técnica. Replays do mesmo evento são deduplicados por constraint única.

## Decisões operacionais

- Webhook continua sendo a fonte principal de transições.
- Reconciliação é fallback de convergência, não uma segunda regra de negócio.
- Snapshot do Asaas pode ser atualizado mesmo quando a transição local é bloqueada.
- A atualização crítica continua protegida pelo lock por pagamento já existente na Fase 2; `version` torna a evolução observável e preparada para OCC.
- Nenhum segredo ou payload sensível é escrito na trilha técnica.

## Verificação executada

- `pnpm prisma validate` — passou.
- `pnpm prisma generate` — passou.
- Migração da Fase 4 no banco de teste — aplicada sem pendências.
- Máquina de estados — 8 testes passando.
- Webhook de pagamento e sincronização — 19 testes passando.
- Handler oficial do webhook Asaas — 11 testes passando.
- Reconciliação — 9 testes passando.
- Precedência/mapeamento — 45 testes passando.
- `pnpm --filter @alusa/finance typecheck` — passou.

## Referências oficiais usadas

- [Asaas — Webhooks](https://docs.asaas.com/docs/webhooks)
- [Asaas — Eventos de pagamento](https://docs.asaas.com/docs/payment-events)
- [Prisma — Transações e retries](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [Prisma — Controle de concorrência otimista](https://www.prisma.io/docs/orm/prisma-client/queries/transactions#optimistic-concurrency-control)

## Próximo cuidado antes de produção

Executar a migração em staging, verificar os índices e acompanhar `reconciliationStatus = DIVERGENT`, backlog de reconciliação e decisões `NOOP/RECONCILE` antes de habilitar tráfego real. O typecheck amplo do app web continua com falhas preexistentes em componentes React/Konva fora do escopo desta fase; o pacote financeiro alterado passa no typecheck direcionado.
