# @alusa/asaas-gateway

Camada fina de **contratos técnicos** Alusa↔Asaas. Não é SDK HTTP e não é camada de negócio.

Ver [docs/adr-asaas-layer-boundaries.md](../../docs/adr-asaas-layer-boundaries.md).

## Responsabilidades

✅ **Permitido:**
- DTOs de webhook (`AsaasWebhookPayload`)
- `parseExternalReference` / `buildExternalReference` (formato v1 legado)
- `WebhookVerifier` (validação de token via DI — sem Prisma direto)
- Enums/tipos literais técnicos
- Erros técnicos (`AsaasGatewayError`)

❌ **Proibido:**
- Prisma, banco, use-cases, persistência
- Chamadas HTTP (use `@alusa/asaas` via `@alusa/finance`)
- Mapeamento Asaas → status interno
- Decisão de pago/vencido/ativo
- Feature flags de rollout financeiro

## Whitelist de exports recomendada

```typescript
import {
  parseExternalReference,
  buildExternalReference,
  WebhookVerifier,
  AsaasGatewayError,
  type AsaasWebhookPayload,
  type WebhookVerifyResult,
} from '@alusa/asaas-gateway';
```

## Consumidores

- **`@alusa/finance`** — orquestração e reexport para aplicação
- **`apps/web`** — deve preferir `@alusa/finance`, não importar gateway diretamente

## Dependências

- `@alusa/asaas` — apenas tipos literais espelho da API quando necessário
