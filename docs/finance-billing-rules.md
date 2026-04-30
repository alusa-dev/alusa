# Regras do Sistema de Cobranças — Alusa

## Modelo Mental (Regra Zero)

- **Cobrança** (`Charge`/`Cobranca`) é o ÚNICO evento financeiro real (valor, vencimento, status, pagamento).
- **Assinatura** (`Subscription`) é um contrato que GERA cobranças recorrentes.
- **Parcelamento** (`InstallmentPlan`/`StandaloneInstallmentPlan`) é um AGRUPADOR que contém cobranças (parcelas).
- A UI nunca mistura níveis: cobranças são cobranças, agrupadores são agrupadores.

---

## Regras de Páginas

### `/cobrancas` — Todas (Fila Operacional)

**NÃO é histórico. NÃO é previsão. É FILA OPERACIONAL.**

| Regra | Descrição |
|-------|-----------|
| Escopo temporal | Somente itens com `dueDate <= fim do mês atual` |
| Status incluídos | PENDING, OVERDUE (pendentes + vencidas) |
| Status excluídos | PAID, CANCELED, REFUNDED (saem da lista ao quitar/cancelar) |
| Assinatura | Somente a cobrança vigente/pendente (não futuras) |
| Parcelamento | NUNCA parcelas soltas; mostrar apenas o agrupador se existir parcela operacional |
| Itens futuros | NÃO aparecem (mês seguinte em diante) |

### `/cobrancas/avulsas` — Cobranças Avulsas

- Lista SOMENTE cobranças standalone "soltas": `Charge` onde `subscriptionId IS NULL` e `standaloneInstallmentPlanId IS NULL`.
- Clique → detalhe da cobrança.

### `/cobrancas/assinaturas` — Assinaturas

- Lista SOMENTE `Subscription` (contratos recorrentes).
- Clique → detalhe da assinatura.
- No detalhe: lista cobranças geradas (payments) e cada item abre o detalhe da cobrança.

### `/cobrancas/parcelamentos` — Parcelamentos

- Lista SOMENTE parcelamentos (`InstallmentPlan` + `StandaloneInstallmentPlan`) como linhas agregadas.
- Clique → detalhe do parcelamento.
- No detalhe: lista parcelas (cobranças) e cada item abre o detalhe da cobrança.

---

## Status Unificado

| UnifiedChargeStatus | StatusCobranca | ChargeStatus |
|---------------------|----------------|--------------|
| PENDING | A_VENCER, PENDENTE | CREATED, OPEN |
| PROCESSING | PROCESSANDO | — |
| PAID | PAGO | PAID |
| OVERDUE | ATRASADO | OVERDUE |
| CANCELED | CANCELADO, CANCELAMENTO_PENDENTE | CANCELED |
| REFUNDED | ESTORNADO, ESTORNADO_PARCIAL | REFUNDED |

**Operacional** = PENDING ou OVERDUE.

---

## Semântica de `value` (ATENÇÃO)

| Modelo | `value` no banco | Total | Por parcela |
|--------|-----------------|-------|-------------|
| `InstallmentPlan` (acadêmico) | Valor **por parcela** | `value × installmentCount` | `value` |
| `StandaloneInstallmentPlan` | Valor **total** | `value` | `value ÷ installmentCount` |

> Meta (FASE 6): adicionar campos explícitos `totalValue` e `installmentValue` em ambos os modelos para eliminar ambiguidade.

---

## Integração Asaas

- **Pagamento avulso**: `POST /v3/payments` (campo `value` = valor da cobrança).
- **Assinatura**: `POST /v3/subscriptions` com `externalReference`.
- **Parcelamento**: `POST /v3/installments` com `installmentCount` e `value` (= valor **por parcela**).
- **Webhook**: validar header `asaas-access-token`; idempotência via `eventId`; persistir payload bruto.
- **externalReference**: formato `alusa:{contaId}:{entity}:{localId}`.

---

## Invariantes

1. Aluno dependente NUNCA é `Customer` no Asaas.
2. Toda cobrança precisa de subconta + customerId do responsável financeiro + vínculo rastreável.
3. Estados financeiros são refletidos via webhook, nunca inferidos.
4. Webhooks são idempotentes e reprocessáveis.
5. Nenhuma mutação financeira sem intenção explícita, validação de pré-condições e auditoria.
