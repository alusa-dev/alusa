# Confiabilidade da venda pública de assentos marcados

Este documento descreve o fluxo operacional de reserva, pagamento, expiração,
webhook, emissão de ingressos e compensação de pagamento tardio. Ele complementa
`docs/asaas-outbound-consistency.md` e a arquitetura do mapa público.

## Fontes de estado

- `EventMapPublicSeat.status` protege a disponibilidade e serializa a disputa
  pelo assento no PostgreSQL.
- `EventMapReservation` registra a posse temporária dos lugares.
- `EventMapOrder` mantém a intenção local, o vínculo do pagamento e o estado de
  emissão.
- O webhook Asaas confirma mudanças financeiras; consulta ao provedor é uma
  reconciliação limitada, não polling contínuo.
- `FinanceWebhookSideEffectOutbox` guarda emails e comandos de estorno com chave
  deduplicada por instituição e operação.
- `FinanceReconciliationIssue` expõe operações ambíguas para análise financeira.

## Fluxo normal

```text
Comprador seleciona assentos
  → POST /api/public/event-maps/:slug/reserve
  → transação bloqueia/verifica todos os assentos e cria reserva + pedido
  → checkout valida pagador e método
  → marca criação de cobrança como PAYMENT_CREATION_UNKNOWN antes do POST
  → POST Asaas com externalReference estável do pedido
  → grava ID remoto e mantém pedido PAYMENT_PENDING
  → webhook é autenticado, persistido na inbox e processado idempotentemente
  → transação marca assentos vendidos, confirma pedido e emite tickets
  → outbox entrega email e demais efeitos secundários
```

O estado pago vem do webhook. O botão de verificação do comprador faz uma
consulta pontual com limite por pedido; a tela de status consulta somente o
estado local. Rotas públicas de checkout e verificação não drenam outboxes nem
fazem trabalho de reconciliação em lote; o endpoint de webhook também encerra
sem drenar os efeitos secundários. A execução deles fica com o scheduler e os
jobs de outbox. Os webhooks Asaas podem ser repetidos e chegar fora de ordem, então
handlers e efeitos usam deduplicação e guards de transição.

## Expiração e criação de cobrança incerta

O job `/api/jobs/events-expire-reservations` roda a cada cinco minutos. Ele
processa no máximo 25 reconciliações externas por execução na configuração
publicada, com limite configurável até 100. Uma cobrança identificada só libera
assentos depois de cancelamento confirmado ou estado remoto equivalente.

`PAYMENT_CREATION_IN_PROGRESS` e `PAYMENT_CREATION_UNKNOWN` não liberam assentos
com base em uma única busca vazia. Depois de dez minutos, o job procura a
referência externa; para um pedido ainda ambíguo, essa consulta é limitada a uma
por hora. Se o Asaas não localizar a cobrança, uma divergência financeira é
aberta e os assentos permanecem retidos até o resultado ser conhecido ou a
operação ser resolvida pela equipe. Essa proteção evita vender um assento e
depois descobrir que uma cobrança ativa foi criada sem resposta local.

Se a criação ainda estiver em curso quando a reserva expirar, a gravação final
da cobrança usa compare-and-set do pedido. Uma resposta tardia nunca reabre o
checkout para o comprador; cobranças ainda pagáveis são canceladas, e a
identidade remota fica disponível para webhook e reconciliação.

## Pagamento após expiração

Ao receber confirmação tardia:

1. A confirmação tenta recuperar atomicamente o conjunto inteiro se a reserva
   expirou e todos os assentos continuam disponíveis.
2. Se algum assento estiver vendido, retido por outro pedido, bloqueado ou
   indisponível, nenhum ticket é emitido para o pedido tardio.
3. **Política definida:** se o assento já não puder ser recuperado, o pedido é
   registrado como pago e sem emissão concluída; um comando idempotente de
   estorno pelo valor efetivamente recebido é gravado no outbox na mesma
   transação. O estorno é solicitado automaticamente; a conclusão financeira
   continua dependendo da confirmação oficial do Asaas.
4. O worker percorre todas as páginas de estornos já criados antes de enviar
   comando. Depois de um envio de resultado incerto, não repete o POST às cegas.
5. Para Pix/cartão, `PENDING` significa que o Asaas aceitou o comando de estorno;
   o outbox encerra a entrega do comando e o estado financeiro final aguarda o
   webhook oficial. Somente `DONE` confirma que o valor foi devolvido.
   Cancelamento ou autorização pendente exigem acompanhamento operacional.
6. Para boleto, a API do Asaas inicia uma solicitação e retorna um link para o
   pagador informar os dados necessários. O outbox persiste esse link e envia
   um e-mail idempotente ao comprador; a devolução só é concluída após o pagador
   preencher o formulário e o Asaas confirmar o resultado por webhook.

## Limites externos e rotinas

| Operação | Limite atual | Rotina / comportamento |
| --- | --- | --- |
| Reserva pública | 30 por mapa e 90 por origem, em 5 min | Redis distribuído |
| Checkout público | 8 por mapa e 20 por origem, em 5 min | Redis distribuído |
| Status do pedido | 20 por pedido e 120 por origem, em 5 min | Consulta somente banco local |
| Verificação manual de pagamento | 3 por pedido e 20 por origem, em 15 min | GET Asaas somente sob ação explícita |
| Expiração/reconciliação | 25 consultas Asaas por job na configuração de produção | Cron a cada 5 min, lock de job e orçamento limitado |
| Emissão de ingressos | lote de até 100 por execução | Cron a cada 5 min e emissão idempotente |
| Inbox e efeitos financeiros | batch e leases existentes | scheduler de webhook, outbox e DLQ |

Em produção, os limites de quota e concorrência do cliente Asaas dependem de
Redis distribuído. O cliente falha fechado com 503 antes do request externo se
Redis estiver ausente ou indisponível; o semáforo reserva slots com uma única
operação atômica para não multiplicar chamadas ao Redis por GET.

Configurações de cron estão em `apps/web/vercel.json` e `vercel.json`; ambas
devem permanecer alinhadas. A execução em produção deve ser confirmada no
ambiente antes de considerar as rotinas ativas.

## Evidência de testes

- Vitest cobre decisão de expiração, orçamento do job, retry de webhook, estado
  ambíguo e idempotência do outbox de estorno.
- Playwright cobre disputa concorrente no PostgreSQL, checkout de PIX/cartão/
  boleto, sincronização pontual antes da liquidação, webhooks repetidos e fora de
  ordem sob entregas concorrentes, recuperação de resposta perdida após o Asaas
  aceitar a cobrança, emissão de tickets, pagamento tardio com e sem assentos disponíveis,
  pagamento tardio após expiração e cancelamento, recuperação quando todos os
  assentos continuam livres e estorno quando algum foi revendido/retido, expiração
  atômica, falha na consulta de customer antes da criação da cobrança
  (incluindo liberação da reserva local) e tentativa de ler/sincronizar pedido
  de outra instituição usando token alheio. O fluxo confirmado também verifica
  que não cria issue genérica de pagamento sem entidade local.
- A suíte usa um adaptador determinístico de Asaas. Ela valida o caminho de
  aplicação e banco; não comprova liquidação bancária real nem comportamento de
  produção do serviço Asaas.

## Documentação oficial Asaas consultada

- [Polling versus webhooks](https://docs.asaas.com/docs/polling-vs-webhooks) — webhook para mudanças; GET pontual para recuperação/conferência.
- [Idempotência de webhooks pelo ID do evento](https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks) — entrega at-least-once, persistência antes de HTTP 200 e processamento assíncrono.
- [Fila pausada](https://docs.asaas.com/docs/fila-pausada) e [penalização de filas](https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas) — só HTTP 200 confirma entrega; 15 falhas consecutivas pausam a configuração, com retenção limitada dos eventos pendentes.
- [Limites e quotas da API](https://docs.asaas.com/reference/rate-e-quota-limit) — quota geral, limite de GETs simultâneos, cabeçalhos `RateLimit-*` e HTTP 429.
- [Retries e idempotência](https://docs.asaas.com/docs/retries-e-idempot%C3%AAncia) — timeout é resultado inconclusivo; consultar o estado anterior antes de repetir uma criação.
- [Listagem e paginação](https://docs.asaas.com/reference/listagem-e-paginacao) — percorrer páginas usando `hasMore`, com `limit` de até 100.
- [Cobranças](https://docs.asaas.com/reference/cobran%C3%A7as)
- [Estornos: eventos para acompanhar conclusão](https://docs.asaas.com/reference/estornos-1)
- [Solicitação de estorno de boleto](https://docs.asaas.com/reference/estornos-1)
- [Status de pagamentos](https://docs.asaas.com/docs/possible-statuses)
- [Interpretação do campo `refunds`](https://docs.asaas.com/docs/refunds)

## Estado da refatoração

1. **Separação de camadas implementada no workspace.** A orquestração de
   cobrança e leitura de instrumentos de pagamento fica em `@alusa/finance`;
   `@alusa/lib` prepara checkout e persiste transições do pedido sem chamar o
   provedor. A verificação pontual de pagamento também fica em
   `packages/finance/src/events/sync-public-event-map-order-payment.ts`.
2. **Matriz adversarial ampliada.** Playwright cobre isolamento de token entre
   instituições, PIX/cartão/boleto, resposta perdida depois da aceitação do POST,
   webhooks repetidos e fora de ordem sob entregas concorrentes, assento
   disputado, retenção durante criação incerta, pagamento tardio, envio de
   estorno pelo outbox, webhook `PAYMENT_REFUNDED`, DLQ persistida e recusa do
   provedor ao comando de estorno. O handler também tem teste unitário para
   `PAYMENT_REFUND_DENIED`: registra o estado recusado e não marca a venda como
   estornada.
3. **Validar operação antes de produção.** Confirmar no ambiente de deploy que
   os crons de expiração, scheduler/outbox e emissão estão ativos; confirmar
   Redis distribuído e alertas para issues financeiras, outbox exaurido e filas
   atrasadas. Revisar o orçamento de conexões do Prisma/driver pooler versus
   concorrência das funções, jobs e workers para evitar saturar o Postgres.
   Executar carga e concorrência em sandbox com orçamento explícito de chamadas
   Asaas, sem usar cobranças reais.

Os itens 1 e 2 foram implementados e validados localmente no workspace. Parte
do item 3 foi confirmada em produção em 25/09/2026: Vercel reportou como `READY`
o deployment `dpl_4nMi4yJHfZe4jf3fvDMwEAtMRt2w`, e logs recentes mostram execução
HTTP 200 do scheduler de webhooks/outbox, expiração de reservas, emissão de
ingressos e reconciliação de pedidos, sem erros nos exemplos observados. Isso
confirma a operação atual dessas rotas; não publica as mudanças presentes neste
workspace. O item 3 continua como gate de promoção: exige deploy/CI e execução
de carga em sandbox Asaas com orçamento de chamadas aprovado. Na revisão de
25/09/2026, a configuração
sanitizada de produção confirmou `DATABASE_URL` no endpoint Neon pooled (`-pooler`),
`DIRECT_URL` no endpoint direto e as variáveis necessárias do Redis distribuído.
O limitador distribuído de GET Asaas estava habilitado, com limite local de 45
e teto distribuído de 50 por conta; `ASAAS_QUOTA_LIMIT` usa o padrão de 25.000
chamadas em 12 horas. Um `PING` autenticado respondeu `PONG`; `EVAL` foi exercitado
com chaves temporárias namespaced para o rate limit, a quota e o semáforo de GET,
confirmando limite e liberação do lease. As chaves temporárias foram apagadas.
Os logs consultados confirmam execução dos crons amostrados, mas não a cobertura
de todos os agendamentos ou a configuração de alertas. Também não confirmam o
orçamento agregado de conexões nem a liquidação de estornos. O projeto Neon que
contém o endpoint de produção não está entre os projetos visíveis no MCP
conectado, então compute, pool do servidor e métricas de produção seguem sem
inspeção.
