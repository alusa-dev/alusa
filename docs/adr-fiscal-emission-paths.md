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

Alusa uses two mutually exclusive automation paths. The decision is made per charge type and payment
link, not per enrollment as a whole:

| Billing source | Fiscal mode | Emission path |
| --- | --- | --- |
| Enrollment fee, standalone charge, extra charge, installment, event/order charge | `ON_PAYMENT` | Alusa handles payment webhook and calls `emitChargeInvoice`. |
| Academic monthly/recurring charge with Asaas invoice settings configured | `ON_PAYMENT` | Asaas emits through `/v3/subscriptions/{id}/invoiceSettings`; Alusa only mirrors `INVOICE_*` webhooks. |
| `StandaloneSubscription` charge linked to the configured Asaas subscription | `ON_PAYMENT` | Asaas emits through `/v3/subscriptions/{id}/invoiceSettings`; Alusa only mirrors `INVOICE_*` webhooks. |
| Any source | `MANUAL` | Alusa shows manual action in charge detail when eligibility allows. |

Before auto-emitting from a payment webhook, Alusa must resolve the emission path using the charge type,
configured subscription and, when present, `payment.subscription`. Enrollment fees must remain local even
when the enrollment also has a configured academic subscription. Native emission skips local emission with
reason `SUBSCRIPTION_NATIVE_EMISSION`.

## Consequences

- `INVOICE_*` webhooks must upsert local `Invoice` records, because Asaas may create invoices without a prior local `Invoice`.
- Subscription fiscal settings must be synchronized after subscription creation and after relevant fiscal settings changes.
- Fiscal readiness must be conservative. If municipal requirements cannot be loaded for a partially configured account, Alusa must not report `READY`.
