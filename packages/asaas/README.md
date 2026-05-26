# @alusa/asaas

Cliente HTTP puro para integração com a API do Asaas.

## Responsabilidades

Este pacote contém **apenas** chamadas HTTP à API do Asaas.

✅ **Permitido:**
- Execução de requisições HTTP
- Validação de entrada (tipos)
- Serialização/deserialização de payloads

❌ **Proibido:**
- Regras de negócio
- Acesso a banco de dados
- Lógica de status interno
- Feature flags
- Mapeamento de status Asaas → domínio

## Princípios (ADRs 001-009)

1. **Todas as funções recebem `apiKey` explicitamente**
2. **`externalReference` é aceito quando aplicável (ADR-006)**
3. **Retornam apenas o payload do Asaas (sem transformações de domínio)**
4. **Sem estado interno ou cache**

## Estrutura

```
src/
├─ client/          # Cliente HTTP base
├─ accounts/        # Criação de subcontas
├─ customers/       # Gestão de customers
├─ payments/        # Cobranças/payments
├─ subscriptions/   # Assinaturas recorrentes
├─ installments/    # Parcelamentos
├─ transfers/       # Transferências (PIX/TED)
├─ webhooks/        # Validação de webhooks
├─ types/           # Tipos TypeScript do Asaas
└─ index.ts         # Exports públicos
```

## Uso

```typescript
import { createPayment } from '@alusa/asaas';

const payment = await createPayment({
  apiKey: 'subconta-api-key',
  customer: 'cus_xxxxx',
  value: 100.00,
  dueDate: '2025-12-31',
  billingType: 'PIX',
  externalReference: 'charge:abc123'
});
```

## Consumidores

Este pacote é consumido exclusivamente por `packages/finance`, que adiciona:
- Regras de negócio
- Validações de tenant
- Feature flags
- Mapeamento de status
- Persistência

Ver também [docs/adr-asaas-layer-boundaries.md](../../docs/adr-asaas-layer-boundaries.md).
