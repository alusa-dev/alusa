# Alusa — Hardening de produção: Fase 1

Esta fase adiciona guardrails operacionais sem alterar a regra de matrícula,
cobrança, pagamento, estorno, recebimento em dinheiro ou emissão fiscal.

## Contratos adotados

- Webhooks do Asaas são `at least once`: o evento deve ser persistido antes do
  `2xx` e processado de forma assíncrona.
- A rota de webhook roda no runtime Node.js e não executa drenagem inline em
  produção.
- PostgreSQL continua sendo a fonte de verdade dos eventos e estados
  financeiros.
- Redis é usado para rate limit distribuído do webhook, quota e semáforo
- O rate limit geral da API usa `RATE_LIMIT_REDIS_TIMEOUT_MS` (1500 ms em
  produção); o valor é limitado pelo código a uma janela segura de 250–2000 ms
- Fallback do rate limit registra duração e timeout para diagnóstico de latência
  distribuído do cliente Asaas, além do cache compartilhado.
- Se Redis ficar indisponível, os controles entram em fallback local e o
  ambiente fica explicitamente degradado; a saúde não é mascarada.

## Variáveis obrigatórias em produção

O guard de boot exige:

- `RLS_RUNTIME_ENABLED=true` e `DATABASE_RLS_URL`;
- `ASAAS_REDIS_ENABLED=true`;
- `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`;
- `TRUST_PROXY_HEADERS=true`, somente quando a Vercel/CDN estiver configurada
  para fornecer headers de origem confiáveis;
- `ASAAS_WEBHOOK_AUTH_TOKEN_SECRET`;
- `ASAAS_WEBHOOK_PUBLIC_BASE_URL`;
- `ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS=true`;
- `ASAAS_WEBHOOK_IP_CHECK=strict`;
- `CRON_SECRET` ou `CRON_SECRET_TOKEN`;
- `CACHE_LAYER_ENABLED=true` e `REDIS_CACHE_ENABLED=true`.

Também são rejeitados em produção:

- `FIN_WEBHOOK_SYNC_OVERRIDE=true`;
- `FIN_WEBHOOK_INLINE_DRAIN=true`;
- `ASAAS_DISTRIBUTED_GET_LIMIT_ENABLED=false`.

O modo estrito de IP deve ser habilitado somente quando a camada de proxy/CDN
preservar o IP real do Asaas. A allowlist usa os IPs oficiais documentados pelo
Asaas e deve ser revisada quando o provedor atualizar sua documentação.

## Operação

- `GET /api/internal/health` verifica banco, URL do Asaas, segredo de webhook
  e conectividade do Redis sem expor credenciais.
- `GET /api/admin/webhooks/metrics/operational?format=prometheus` expõe
  volume recente de chamadas Asaas, quota, circuit breaker, concorrência e
  estado da topologia de webhook.
- `pnpm validate:cron-config` garante que `vercel.json` e
  `apps/web/vercel.json` tenham exatamente a mesma agenda.

## Referências oficiais consultadas

- [Asaas — idempotência em Webhooks](https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks)
- [Asaas — recebimento de eventos](https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook)
- [Asaas — penalização de filas](https://docs.asaas.com/docs/penalização-de-filas)
- [Asaas — polling vs. webhooks](https://docs.asaas.com/docs/polling-vs-webhooks)
- [Asaas — API Limits](https://docs.asaas.com/docs/api-limits-1)
- [Next.js — Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- [Next.js — Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
