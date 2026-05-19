# ADR: Estados de cobrança Alusa × Asaas

## Contexto

O Asaas expõe ~15 status de payment (`PENDING`, `CONFIRMED`, `RECEIVED`, `OVERDUE`, etc.). O ERP da Alusa usa `StatusCobranca` de negócio (`A_VENCER`, `PENDENTE`, `PAGO`, `ATRASADO`, …) mais:

- `asaasStatus` — espelho bruto do provedor
- `liquidacaoStatus` — saldo creditado na conta Asaas (`PENDENTE` / `DISPONIVEL` / `NAO_APLICAVEL`)

## Decisões

1. **Webhook é fonte de verdade** para mudança de `status` e `liquidacaoStatus`.
2. **`PAGO` unifica CONFIRMED e RECEIVED** no negócio; a distinção aparece em `liquidacaoStatus` + `asaasStatus`.
3. **`A_VENCER`** deriva de `PENDING` + `dueDate` futuro (enriquecimento Alusa).
4. **`AWAITING_RISK_ANALYSIS` → `PROCESSANDO`** (não “pendente”).
5. **`RECEIVED_IN_CASH`**: `status=PAGO`, `liquidacaoStatus=DISPONIVEL` operacional; saldo Asaas exclui via `asaasStatus != RECEIVED_IN_CASH`.
6. **Liquidação canônica**: `resolveLiquidacaoFromAsaasPayment()` em `packages/finance/src/mappers/liquidacao-from-asaas.ts`.
7. **Tempo real**: após webhook, `publishFinanceEvent` + poll `/api/finance/realtime/events` + React Query no detalhe.

## Fluxos Asaas

| Fluxo | Asaas | Alusa |
|-------|-------|-------|
| Boleto | PENDING → CONFIRMED → RECEIVED | PAGO + liquidação PENDENTE → DISPONIVEL |
| Pix | PENDING → RECEIVED | PAGO + liquidação conforme creditDate |
| Vencida | PENDING → OVERDUE → … | ATRASADO → PAGO |

## Referência

- Mapper: `packages/finance/src/mappers/charge-status/asaas-to-internal.ts`
- Precedência: `packages/finance/src/mappers/status-precedence.ts`
- UI composta: `resolveCobrancaDisplayStatus()`
