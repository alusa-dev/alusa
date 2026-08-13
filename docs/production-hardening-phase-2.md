# Alusa — hardening de produção, Fase 2

Esta fase reforça as fronteiras que evitam duplicidade, processamento concorrente e atualização financeira fora da `Conta`. Os fluxos de matrícula, cobrança, pagamento, estorno, recebimento em dinheiro e nota fiscal não foram reescritos; a alteração está nas garantias de persistência e nos workers que os sustentam.

## Entregas

### 1. Identidade Asaas sempre resolvida dentro do tenant

`Cobranca`, `Pagamento` e `Charge` agora têm chaves únicas compostas por `contaId` + `asaasPaymentId`. Os `findUnique` e `upsert` críticos do handler de pagamento usam essas chaves compostas; as materializações e estornos de `Pagamento` também filtram por `contaId`.

As constraints globais legadas de `asaasPaymentId` foram preservadas nesta fase para não alterar dados existentes sem um plano de migração específico. Elas não substituem o filtro de tenant: a regra de aplicação continua sendo “nunca atualizar por ID Asaas sem `contaId`”.

### 2. Lease e fencing nos outboxes

`RematriculaOutbox` e `FinanceWebhookSideEffectOutbox` receberam:

- `leaseExpiresAt`, para recuperação automática de um worker morto;
- `lockToken`, um token aleatório por tentativa;
- claim condicional por status, tenant, disponibilidade e limite de tentativas;
- finalização condicional pelo mesmo `lockToken`.

Se um lease expirar e outro worker assumir o evento, o worker antigo pode até terminar uma chamada já iniciada, mas não consegue marcar o evento como `PROCESSED` ou sobrescrever o retry do novo worker. Linhas antigas em `PROCESSING` sem lease também são recuperadas na primeira drenagem após o deploy.

Lease padrão dos dois outboxes: 10 minutos. O limite existente de tentativas foi preservado: 8 para rematrícula e 5 para efeitos financeiros.

### 3. Heartbeat do lock de scheduler

`withWebhookJobLock` renova o lease periodicamente enquanto o job executa. A renovação é condicionada a `jobName`, `workerId` e lease ainda válido. O release também continua condicionado ao `workerId`, evitando que um worker antigo libere o lock que já foi reassumido.

O heartbeat ocorre aproximadamente a cada um terço do TTL, limitado entre 5 segundos e 60 segundos. A função `renewWebhookJobLock` foi exportada para jobs que precisarem de uma renovação explícita.

## Migration

Migration aplicada no banco de teste:

`prisma/migrations/20260813180000_phase_2_reliability_hardening/migration.sql`

Ela cria as constraints compostas e adiciona apenas colunas novas nos outboxes; não remove histórico financeiro nem altera dados de matrícula.

## Verificações executadas

- `pnpm prisma validate`
- `pnpm prisma generate`
- `pnpm --filter @alusa/web db:migrate:test`
- typecheck de `@alusa/finance`
- testes de fencing/heartbeat dos locks e outbox financeiro: 7 testes
- teste de lease/fencing do outbox de rematrícula: 1 teste
- testes existentes de webhook Asaas/pagamento: 26 testes
- teste existente do outbox de cobrança de matrícula: 7 testes
- `git diff --check`

## Operação após o deploy

Monitore por `contaId`, tipo de outbox e job:

- eventos `PROCESSING` com `leaseExpiresAt` vencido;
- crescimento de `FAILED`/DLQ e idade do evento mais antigo;
- ocorrências de `LEASE_LOST`/`lease_lost`;
- discrepâncias entre estado local e Asaas para reconciliação.

Um `LEASE_LOST` não é sucesso silencioso: o worker não tem autorização para sobrescrever o novo dono do evento e o próximo ciclo deve observar o estado persistido.

## Referências oficiais consultadas

- [Asaas — idempotência em webhooks](https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks)
- [Asaas — endpoint de webhook](https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook)
- [Asaas — FAQ de webhooks](https://docs.asaas.com/docs/faq-de-webhooks)
- [Prisma — transações e isolamento](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [Prisma — constraints e índices compostos](https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes)
- [Next.js — duração máxima e execução de requests](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config)
