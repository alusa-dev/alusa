# ADR: Fiscal emission paths for NFS-e

> Referência completa da feature: [fiscal-nfse-feature.md](./fiscal-nfse-feature.md)

## Status

Accepted.

## Context

Alusa supports NFS-e issuance through Asaas for tenant-scoped educational billing. The product has two billing shapes with different operational guarantees:

- Standalone charges, installments and non-subscription payments are local Alusa operational charges. Alusa reacts to payment webhooks and schedules/emits the invoice through the Asaas invoice API.
- Academic subscriptions are recurring Asaas subscriptions. Asaas provides native invoice settings per subscription and can generate invoices automatically for subscription billings.

Using both paths for the same billing can duplicate invoices.

## Decision

Alusa uses two mutually exclusive automation paths:

| Billing source | Fiscal mode | Emission path |
| --- | --- | --- |
| Standalone charge, installment, event/order charge | `ON_PAYMENT` | Alusa handles payment webhook and calls `emitChargeInvoice`. |
| Academic `Subscription` with Asaas invoice settings configured | `ON_PAYMENT` | Asaas emits through `/v3/subscriptions/{id}/invoiceSettings`; Alusa only mirrors `INVOICE_*` webhooks. |
| `StandaloneSubscription` with Asaas invoice settings configured | `ON_PAYMENT` | Asaas emits through `/v3/subscriptions/{id}/invoiceSettings`; Alusa only mirrors `INVOICE_*` webhooks. |
| Any source | `MANUAL` | Alusa shows manual action in charge detail when eligibility allows. |

Before auto-emitting from a payment webhook, Alusa must check whether the charge belongs to a subscription with native invoice settings enabled. If so, it skips local emission with reason `SUBSCRIPTION_NATIVE_EMISSION`.

## Consequences

- `INVOICE_*` webhooks must upsert local `Invoice` records, because Asaas may create invoices without a prior local `Invoice`.
- Subscription fiscal settings must be synchronized after subscription creation and after relevant fiscal settings changes.
- Fiscal readiness must be conservative. If municipal requirements cannot be loaded for a partially configured account, Alusa must not report `READY`.
