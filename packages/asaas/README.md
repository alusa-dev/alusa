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
4. **Sem estado de negócio; estado operacional transitório é permitido para resiliência**

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

## Controles operacionais da API

O cliente aplica os limites documentados pelo Asaas:

- quota de 25.000 requisições por conta em uma janela móvel de 12 horas;
- leitura dos cabeçalhos `RateLimit-Limit`, `RateLimit-Remaining` e `RateLimit-Reset`, com espera antes de novas chamadas quando o saldo chega a zero;
- até 50 GETs concorrentes por conta. O limite local padrão é 45 para manter margem operacional.

As chamadas mutáveis só são repetidas automaticamente quando possuem `Idempotency-Key`. O contador de quota é reservado por tentativa física, e não por chamada lógica.

Em produção, configure `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` e `ASAAS_REDIS_ENABLED=true` para compartilhar quota e semáforo de GET entre instâncias. Sem Redis, o cliente mantém fallback em memória por processo, com o limite local de segurança; isso não substitui o controle distribuído em múltiplas réplicas.

Variáveis opcionais: `ASAAS_MAX_CONCURRENT_GETS` (máximo local, limitado a 50), `ASAAS_GET_CONCURRENCY_WAIT_TIMEOUT_MS`, `ASAAS_GET_LEASE_TTL_MS`, `ASAAS_QUOTA_LIMIT`, `ASAAS_QUOTA_REDIS_KEY_PREFIX` e `ASAAS_GET_REDIS_KEY_PREFIX`.
