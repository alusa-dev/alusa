# Cobertura: atualização financeira em tempo real

Após webhooks Asaas, `publishFinanceEvent` grava eventos no Upstash; o cliente faz poll (`useFinanceRealtime` + `useFinanceRealtimeSync`) e invalida React Query ou chama `onListRefresh`.

## Hook central

`useFinanceLiveRefresh` = `useLiveRefresh` (foco + intervalo) + `useFinanceRealtimeSync` (poll ~3s pós-webhook).

```ts
useFinanceLiveRefresh(() => load(true), {
  cobrancaId?: string,           // detalhe: filtra eventos
  realtime?: false | {           // escopo de invalidação
    dashboard?: boolean,
    financeiro?: boolean,
    portal?: boolean,
    cobrancaQueries?: boolean,
  },
  enabled, intervalMs, minIntervalMs,
});
```

**Env:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`; `FINANCE_REALTIME_PUSH_ENABLED=false` desliga push.

## Telas cobertas

| Área | Tela | Arquivo | Escopo realtime |
|------|------|---------|-----------------|
| Admin | Todas cobranças | `app/(app)/cobrancas/page.tsx` | padrão |
| Admin | Detalhe cobrança | `cobrancas/[id]/CobrancaDetalhesClient.tsx` | `cobrancaId`, `cobrancaQueries: false` |
| Admin | Avulsas | `cobrancas/avulsas/page.tsx` | padrão |
| Admin | Parcelamentos lista | `cobrancas/parcelamentos/page.tsx` | `cobrancaQueries: false` |
| Admin | Parcelamento detalhe | `parcelamentos/[id]/ParcelamentoDetalheClient.tsx` | padrão |
| Admin | Assinaturas lista | `cobrancas/assinaturas/page.tsx` | `cobrancaQueries: false` |
| Admin | Assinatura detalhe | `assinaturas/[id]/AssinaturaDetalheClient.tsx` | padrão |
| Admin | Dashboard | `dashboard/DashboardClient.tsx` | só `useFinanceRealtimeSync` |
| Admin | Saldo KPI | `dashboard/components/SaldoCard.tsx` | padrão |
| Financeiro | ChargesTable | `features/financeiro/cobrancas/ChargesTable.tsx` | padrão |
| Financeiro | Pagamentos lista | `pagamentos/PaymentsTable.tsx` | padrão |
| Financeiro | Pagamento por aluno | `pagamentos/PagamentoAlunoDetalhesClient.tsx` | `portal: false` |
| Financeiro | Conta / extrato | `conta/ContaPage.tsx`, `extrato/useExtratoQuery.ts` | padrão |
| Financeiro | Transferência detalhe | `conta/ContaTransferDetailPage.tsx` | `dashboard/portal: false` |
| Financeiro | Antecipações | `antecipacoes/*Page.tsx`, `MinhasAntecipacoesPage.tsx` | `portal: false` onde aplicável |
| Portal | Financeiro lista | `portal/financeiro/PortalFinanceiroTable.tsx` | `dashboard/financeiro: false` |
| Portal | Cobrança detalhe | `portal/financeiro/CobrancaDetalhesFeature.tsx` | `cobrancaId`, admin queries off |
| Portal | Dashboard | `portal/dashboard/PortalDashboardFeature.tsx` | `dashboard/financeiro: false` |

## Fora de escopo (intencional)

- Modais/diálogos pontuais (`CobrancaEditarDialog`, `MatriculaDetalhesDialog`) — dados recarregam ao fechar ou via invalidação global.
- CRUD estático (`centros-custo`, onboarding Asaas).
- `PortalFinanceiroFeature.tsx` — legado; rota usa `PortalFinanceiroTable`.

## Status de cobrança (modelo)

Ver `docs/adr-cobranca-status-asaas.md` — `status`, `asaasStatus`, `liquidacaoStatus`, `displayStatus`.
