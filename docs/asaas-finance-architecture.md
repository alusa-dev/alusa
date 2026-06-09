# Arquitetura Financeira Asaas

Status: fluxo oficial consolidado nesta refatoração

## Fluxo oficial

```txt
apps/web
  -> @alusa/finance
  -> @alusa/asaas-gateway
  -> @alusa/asaas
  -> API Asaas
```

## Responsabilidades

- `apps/web`: autenticação, autorização, validação HTTP, DTOs e resposta.
- `@alusa/finance`: comandos financeiros, webhooks, reconciliação, auditoria, idempotência, read models e políticas operacionais.
- `@alusa/asaas-gateway`: contratos técnicos, payloads de webhook, verificação e `externalReference`.
- `@alusa/asaas`: cliente HTTP puro, rate limit, circuit breaker, retries e tipos da API externa.

## Regras

- Toda operação financeira tenant-scoped deve receber `contaId` validado no servidor.
- Toda cobrança enviada ao Asaas deve ter referência rastreável (`externalReference`) ou vínculo local persistido.
- Webhooks são a fonte operacional para confirmação de estados financeiros.
- Recebimento em dinheiro no Asaas é tratado como pagamento confirmado: o fluxo oficial retorna
  `PAYMENT_RECEIVED` com `billingType: RECEIVED_IN_CASH`, e a Alusa deve bloquear edição/cancelamento
  como qualquer cobrança paga.
- Rotas de baixa manual devem chamar o caso de uso canônico `markChargeAsPaid`.
- Telas leem estado local/read models; Asaas é usado para preflight, reconciliação, documentos oficiais e suporte.
- O resolver determinístico de pagamento é parte do fluxo oficial, sem nomes versionados em código novo.

## Rota canônica de baixa manual

```txt
POST /api/financeiro/cobrancas/[id]/marcar-pago
```

As rotas legadas de baixa manual foram removidas após migração das chamadas do frontend.

## Eventos públicos

Os serviços de eventos em `packages/lib/src/events` não importam mais o cliente Asaas diretamente.
Eles dependem da porta `EventAsaasPaymentProvider`, registrada pela aplicação com um adapter de
`@alusa/finance`. Isso preserva a fronteira `apps/web -> @alusa/finance -> @alusa/asaas` sem criar
ciclo entre `@alusa/lib` e `@alusa/finance`.

## Referências oficiais Asaas

- Webhooks e eventos de cobrança: https://docs.asaas.com/docs/payment-events
- Idempotência em webhooks: https://docs.asaas.com/docs/how-to-implement-idempotence-in-webhooks
- Criar cobrança: https://docs.asaas.com/reference/criar-nova-cobranca
- Criar customer e evitar duplicidade: https://docs.asaas.com/reference/create-new-customer
