# Alusa Performance Cache And Read Models

## Flags

- `CACHE_LAYER_ENABLED=false`: mantém o comportamento legado das rotas.
- `REDIS_CACHE_ENABLED=false`: usa cache em memória mesmo com a nova camada ligada.
- `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`: habilitam adapter Redis REST quando `REDIS_CACHE_ENABLED=true`.
- `FIN_READMODEL_ENABLED=true`: listagens standalone usam `ChargeReadModel` primeiro.
- `FIN_SUMMARY_READMODEL_ENABLED=false`: `finance-kpis` usa snapshot financeiro local quando ligado, com fallback para o caminho operacional atual.
- `DASHBOARD_BLOCKS_ENABLED=false`: mantém os novos blocos de dashboard indisponíveis no backend.
- `NEXT_PUBLIC_DASHBOARD_BLOCKS_ENABLED=false`: mantém a UI consumindo `/api/dashboard/metrics`; quando ligada, a UI tenta os blocos e volta para o endpoint legado se algum bloco falhar.
- `SUPPORT_CACHE_ENABLED=false`: cache curto para overview global do suporte.

## Rollback

- Problema em Redis: desligar `REDIS_CACHE_ENABLED`.
- Problema na camada nova: desligar `CACHE_LAYER_ENABLED`.
- Problema no snapshot financeiro: desligar `FIN_SUMMARY_READMODEL_ENABLED`.
- Problema nos blocos do dashboard: desligar `NEXT_PUBLIC_DASHBOARD_BLOCKS_ENABLED` primeiro; desligar `DASHBOARD_BLOCKS_ENABLED` remove os endpoints do backend.

## Vercel/Neon

- Projeto Vercel validado via MCP: `alusa-web`, framework `nextjs`, Node `20.x`.
- Deploy de produção validado via MCP: `dpl_3eR1zN84T9Se1osTC5YUhT8yCe2X`, estado `READY`, aliases `alusa.app` e `www.alusa.app`, functions em `gru1`.
- Projeto Neon identificado anteriormente: `Alusa`, região `aws-sa-east-1`, alinhado com a região operacional definida para o app.
- Migration `20260517020000_add_finance_summary_read_model` aplicada em produção e registrada em `_prisma_migrations`.
- `FinanceSummaryReadModel` e seus índices foram validados na base de produção.

## SQL Indexes

Nenhum índice novo foi criado além do índice do novo `FinanceSummaryReadModel`.
As próximas otimizações de índice devem ser baseadas em `pg_stat_statements` e `EXPLAIN ANALYZE` das queries reais.

Checklist operacional:

- `pg_stat_statements`: instalado e validado na base de produção.
- Coletar slow queries de `/api/dashboard/metrics`, `/api/dashboard/finance-kpis`, cobranças, suporte e webhooks.
- Rodar `EXPLAIN ANALYZE` antes de propor novos índices.
- Usar `CREATE INDEX CONCURRENTLY` em produção quando aplicável.
