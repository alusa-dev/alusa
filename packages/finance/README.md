# @alusa/finance

Orquestração financeira, casos de uso, mappers e webhook handlers.

## Responsabilidades

- ✅ Casos de uso financeiros (criar customer, criar pagamento, criar assinatura)
- ✅ Mappers de status Asaas → status interno
- ✅ Webhook handlers (payment, subscription)
- ✅ Lógica de idempotência e retry
- ✅ Auditoria de operações financeiras
- ✅ Casos de uso financeiros do módulo de eventos: checkout público, vendas,
  cobranças de inscrições, emissão/reconciliação, cancelamentos e estornos.

## Princípios (ADRs 001-009)

- **Subconta por tenant** (cada conta tem seu apiKey)
- **Webhook como fonte da verdade** (status vem do webhook)
- **Backend único integrador** (apps/web só consome @alusa/finance)
- **ExternalReference ponte universal** (matrícula.id ↔ asaasPaymentId)
- **Status normalizados** (Asaas → interno)
- **Idempotência** com idempotency keys
- **Segurança** com verificação de assinatura webhook

## Uso

```typescript
import { createAsaasCustomer, createAsaasPayment, handlePaymentWebhook } from '@alusa/finance';

// Criar customer
const result = await createAsaasCustomer({
  contaId: 'conta-123',
  name: 'João Silva',
  cpfCnpj: '12345678900',
  email: 'joao@example.com',
  externalReference: 'aluno-456',
});

if (result.success) {
  console.log('Customer criado:', result.data.id);
}

// Processar webhook
await handlePaymentWebhook(contaId, webhookPayload, signature);
```

## Arquitetura

```
finance/
├── mappers/          # Asaas → interno (status, billing type)
├── use-cases/        # Criar customer, payment, subscription
├── webhooks/         # Handlers de webhooks (payment, subscription)
└── index.ts          # Exports públicos
```

`@alusa/finance` pode compor contratos estreitos de persistência e domínio de
`@alusa/lib`. A dependência segue em uma direção: `apps/web → finance → lib`;
`lib` não importa casos de uso financeiros. Mudanças financeiras de eventos
devem entrar por um caso de uso de `finance`, mantendo validação HTTP e
apresentação na aplicação web.
