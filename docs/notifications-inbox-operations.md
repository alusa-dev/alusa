# Inbox operacional de notificações

## Política

A inbox interna é reservada para mudanças que exigem atenção operacional: pagamento confirmado, estorno/contestação, cobrança vencida ou cancelada, contrato assinado/expirando/expirado/cancelado, cancelamento de matrícula, transferências, bloqueios e falhas de integração.

Confirmações imediatas de interface, como matrícula criada, permanecem no toast e na auditoria, mas não são persistidas na inbox.

## Cache e quota

O feed usa TTL de 30 segundos e o contador de não lidas usa TTL de 60 segundos. Em produção com mais de uma réplica, habilitar:

```env
CACHE_LAYER_ENABLED=true
REDIS_CACHE_ENABLED=true
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

O adaptador Redis/Upstash é compartilhado com as demais áreas do ERP e possui fallback em memória. A invalidação é limitada ao `contaId` e usuário afetado; não existe limpeza global de cache em uma ação de usuário.

## Retenção

O cron `/api/jobs/archive-low-value-notifications?olderThanDays=30&limit=500` arquiva eventos legados de baixo valor em lotes. O registro e o `AuditLog` não são apagados. A migration de backfill arquiva os registros antigos já existentes.

## Agrupamento financeiro

Confirmações equivalentes de pagamento são agrupadas em janelas de 15 minutos por tenant e canal. O digest mostra nomes e quantidade, mantendo os identificadores de pagamento no metadata. Estornos, chargebacks, vencimentos e cancelamentos continuam como eventos individuais.

## Observabilidade

Os eventos de inbox são agregados em memória e emitidos como logs estruturados no máximo uma vez por minuto por tipo, reduzindo ruído e custo de ingestão. Para diagnóstico temporário, usar `NOTIFICATION_METRICS_VERBOSE=true`; não deixar essa opção habilitada permanentemente em produção.
