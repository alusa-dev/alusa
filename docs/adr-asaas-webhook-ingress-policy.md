# ADR: Asaas Webhook Ingress & Processing Policy

**Status:** Accepted  
**Data:** 2026-05-26

## Contexto

Webhooks do Asaas são a fonte primária de mudança de estado financeiro na Alusa. A resposta HTTP ao Asaas precisa diferenciar erro técnico antes da persistência de erro interno após o evento já estar salvo.

Responder `200` antes de persistir pode perder evento. Responder `5xx` depois de persistir pode gerar retries externos desnecessários para falhas que a Alusa já consegue reprocessar pela fila local.

## Decisão

Todo webhook aceito para processamento deve ser persistido em `WebhookAsaas` antes de a rota responder `200` ao Asaas.

Depois de persistido, falhas de handler são internas: o registro deve permanecer como `ERRO`, `PENDENTE`, `EXAURIDO` ou estado equivalente de retry/DLQ, e a rota deve responder `200`.

Rejeições por contrato ou segurança devem ser auditadas em `WebhookAsaasRejection` quando possível.

## Política HTTP

| Situação | Resposta |
| --- | --- |
| Evento válido não persistido por falha técnica | `500` ou `503` |
| Ambiente/segredo obrigatório ausente antes da persistência | `503` |
| JSON inválido | `400` em modo strict; compatibilidade pode responder `200` fora de produção |
| Token ausente | `401` em modo strict; compatibilidade pode responder `200` fora de produção |
| Token inválido | `403` em modo strict; compatibilidade pode responder `200` fora de produção |
| Evento duplicado já persistido | `200` |
| Evento persistido e handler falhou | `200` |
| Evento persistido e processado | `200` |

## Consequências

- O Asaas só recebe `200` para eventos que a Alusa já tem como inbox local ou rejeição controlada.
- Falhas técnicas antes da persistência continuam retryable pelo Asaas.
- Falhas após persistência deixam de depender de retry externo e passam por retry, replay, reconciliação ou DLQ da Alusa.
- A rota HTTP permanece fina; regra financeira e idempotência ficam em `@alusa/finance`.

## Referências

- `apps/web/app/api/webhooks/asaas/route.ts`
- `packages/finance/src/webhooks/asaas-webhook-handler.server.ts`
- `prisma/schema.prisma` (`WebhookAsaas`, `WebhookAsaasRejection`)
