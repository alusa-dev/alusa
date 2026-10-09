# Operação da bilheteria online

Este runbook cobre reservas de assentos do mapa público, pedidos e emissão de ingressos. O estado financeiro vem dos webhooks/reconciliação do Asaas; o cron de expiração não libera assentos enquanto uma cobrança está ativa ou sua criação permanece inconclusiva.

## Jobs agendados

As definições estão em `vercel.json` e em `apps/web/vercel.json` (manter as duas cópias alinhadas):

| Job | Frequência | Função |
| --- | --- | --- |
| `/api/jobs/events-expire-reservations?maxAccounts=30&limit=100&maxExternalPaymentChecks=25` | A cada 5 min | Expira reservas seguras; reconcilia cobranças antes de liberar assentos. |
| `/api/jobs/events-reconcile-orders?maxAccounts=20&limit=50&olderThanMinutes=5` | A cada 15 min | Corrige pedidos pendentes elegíveis por conta. |
| `/api/jobs/events-fulfill-tickets?maxAccounts=20&limit=100` | A cada 5 min | Emite ingressos após confirmação financeira. |
| `/api/jobs/process-ticket-email-outbox?limit=100` | A cada 5 min | Entrega e-mails pendentes com retry idempotente. |
| `/api/jobs/events-inspect-financial-inconsistencies?maxAccounts=30&limit=200` | Hora a hora | Materializa inconsistências para acompanhamento operacional. |

Essas configurações indicam agendamento pretendido; não comprovam execução em produção. Verifique no painel de deployments/cron e nos logs estruturados de cada execução: `status`, duração, quantidade processada/expirada/pulada, erros e `contaId` quando disponível. Investigue execuções ausentes, falhas recorrentes, backlog de pedidos antigos e reservas vencidas que seguem `HELD`.

A Vercel não repete automaticamente uma invocação de cron que falhou, e execuções agendadas podem se sobrepor quando uma invocação ainda está em andamento. Os locks transacionais no banco serializam alterações concorrentes da mesma reserva e as varreduras idempotentes permitem que execuções agendadas posteriores processem o backlog. Monitore falhas/ausência de execuções e o backlog junto aos logs; após falha ou atraso, confirme que as próximas execuções convergiram. Se o backlog continuar crescendo ou não diminuir após execuções bem-sucedidas, investigue erros e capacidade do job e acione a reconciliação operacional documentada, sem editar registros diretamente.

Os caminhos síncronos de reserva e checkout não percorrem reservas vencidas da conta. Um conflito 409 atualiza o mapa e a disponibilidade exibida ao comprador; assentos vencidos só são liberados pelo job após a decisão segura. O limite `limit` é aplicado por conta e por execução, com `maxAccounts` contas no máximo; o orçamento de reconciliação externa é global por execução (`maxExternalPaymentChecks`). Com a configuração acima, cada execução lê no máximo 3.000 reservas e encaminha no máximo 25 reservas para reconciliação externa; cada reconciliação pode precisar de mais de uma chamada ao provedor. O backlog pode levar múltiplas execuções para convergir.

Checkout, confirmação financeira, expiração, cancelamento e estorno serializam as transições da mesma reserva com um lock transacional identificado por `contaId` e `reservationId`. A unicidade tenant-scoped do pagamento no banco impede que um mesmo pagamento seja associado a dois pedidos da mesma conta.

Os cron jobs da Vercel precisam estar definidos em `vercel.json` e o handler valida `Authorization: Bearer $CRON_SECRET` (também aceita `CRON_SECRET_TOKEN` e `x-cron-token`). Configure o segredo no ambiente de produção e confirme uma execução autenticada após cada promoção; uma configuração no arquivo não comprova que a versão ativa executou o cron.

## Capacidade e teste de carga

A meta de negócio é suportar mais de 500 compradores simultâneos em jornadas completas. O perfil inicial do harness é distinto: ele mede somente GET do mapa, com 600 VUs sustentados e estresse até 1.000 VUs; esses VUs não representam compradores completos e não provam a meta de negócio. A reserva concorrente é um segundo ensaio controlado; jornadas completas incluindo checkout e pagamento na sandbox precisam de um teste de preview posterior e separado. Nenhuma dessas metas foi medida nem aprovada para produção.

Execute somente em deployment e banco não produtivos, isolados, com mapas e assentos sintéticos, contas de teste e integração financeira em sandbox. Não aponte geradores de carga para produção: o fluxo de reserva altera inventário e checkout pode gerar cobranças reais se o ambiente estiver configurado incorretamente. Para avaliar os rate limits, o preview precisa usar Redis compartilhado e `TRUST_PROXY_HEADERS=true`; em desenvolvimento local o rate limit pode ser ignorado, então não representa a proteção real. Não simule IPs forjando cabeçalhos.

Ordem dos ensaios, mantendo os perfis separados:

1. Faça linha de base e ramp-up do GET somente leitura do mapa para 100, 300 e 600 VUs, sustente 600 por 15 minutos e acompanhe recuperação após o pico.
2. Em execução separada, estresse somente leitura até 1.000 VUs. Interrompa se o serviço degradar, o pool esgotar ou o ambiente afetar outros testes.
3. Execute a reserva concorrente como teste controlado independente, com assentos sintéticos exclusivos ou disputa por um assento. Não confunda esse teste de endpoint com jornada completa; confirme que holds expiraram antes de reutilizar o fixture.
4. Depois, execute jornada completa em preview isolado com mais de 500 compradores sintéticos, mapa, reserva, checkout e pagamento sandbox. Separe resultados de leitura, reserva e pagamento; checkout não deve ocorrer em produção.
5. Meça cenário de rede compartilhada e distribuída sem forjar cabeçalhos. Os limites são: reserva e checkout 1.500 por subject em cinco minutos; status 15.000 por subject e 60 por pedido em cinco minutos; sincronização manual de pagamento 20 por subject em 15 minutos. No status, o limite agregado precede a leitura e o bucket por pedido só é criado depois que o token valida o pedido. As regras estão em [`public-event-map-rate-limit.ts`](../../apps/web/src/server/events/public-event-map-rate-limit.ts). Os endpoints públicos usam IP de headers confiáveis com `TRUST_PROXY_HEADERS=true`; se a origem confiável não estiver disponível, caem em um subject compartilhado fixo, sem usar `User-Agent` ou idioma como identidade. Esse fallback impede chaves controladas pelo cliente, mas pode causar `429` coletivo para usuários e eventos; por isso, valide a configuração do proxy no Preview e meça `429`. Egressos distintos só produzem subjects distintos quando `TRUST_PROXY_HEADERS=true` e os headers confiáveis de IP do cliente estão configurados. Registre `429` e investigue bloqueio de compradores legítimos atrás de NAT, incluindo consultas repetidas ao status durante o pagamento.
6. Registre commit, deployment, perfil de carga, volume de leituras/reservas/checkouts, latência p50/p95/p99, erros por status, `429`, conflitos de assento, espera de lock, conexões do banco, retries e backlog de jobs/outbox.
7. Confirme integridade depois de cada teste: nenhum assento duplicado, nenhum pedido cruzado entre contas, nenhuma emissão sem confirmação e nenhuma reserva de teste presa. Avalie os limites de serviço antes do ensaio e anexe os resultados separados ao gate de promoção.

Como linha de partida técnica, medir mapa GET com p95 ≤ 2 s e p99 ≤ 4 s, reserva com p95 ≤ 2 s e p99 ≤ 5 s, **zero respostas 5xx** e pool de conexões abaixo de 80% durante sustentação. Esses valores são metas iniciais para o ensaio, não um SLA contratual; revisar depois da linha de base e separar a latência do serviço de pagamento.

Use `ramping-vus` para as etapas e thresholds do k6 para falhar o ensaio quando os critérios forem violados ([documentação do k6](https://grafana.com/docs/k6/latest/using-k6/scenarios/), [thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)). Rode contra um Preview Deployment com variáveis e banco isolados ([ambientes Vercel](https://vercel.com/docs/deployments/environments)); compare timing e logs do deployment específico com `vercel httpstat` e `vercel logs` ([diagnóstico de funções](https://vercel.com/docs/functions/debug-slow-functions)). A escala automática das funções não substitui os testes do banco, Redis e limites do plano ([concorrência Vercel](https://vercel.com/docs/functions/concurrency-scaling)).

Não declare a meta de mais de 500 compradores completos aprovada com base apenas no perfil GET de 600/1.000 VUs ou em E2E funcional de baixa escala: a aprovação requer os gates separados de leitura, concorrência de reservas, checkout/pagamento em sandbox, teste com múltiplas contas e validação de integridade do banco.

### Pool do banco e escala das funções

A escala das funções não aumenta automaticamente a capacidade do PostgreSQL. Antes de cada ensaio, confirme que `DATABASE_URL` usa o endpoint pooled do ambiente de teste, `DIRECT_URL` usa o endpoint direto para migrations, e que o client Prisma é reutilizado por instância. Dimensione o orçamento agregado considerando instâncias web simultâneas, funções de cron, workers e outros consumidores; o total deve permanecer abaixo do limite do banco com margem para conexões administrativas. Não aumente `connection_limit` ou concorrência para “resolver” fila sem medir conexões ativas, aguardando, timeout de aquisição e latência do banco.

Verifique as configurações de concorrência/compute para o deployment Preview específico e para Production separadamente. Fluid Compute e limites de concorrência podem variar por ambiente; registre a configuração usada no ensaio. O pool precisa ser medido junto à taxa de escala das funções, pois várias instâncias podem abrir pools em paralelo. Use a documentação da [Vercel sobre pooling de banco em Functions](https://vercel.com/kb/guide/connection-pooling-with-functions), [concorrência e escala de Functions](https://vercel.com/docs/functions/concurrency-scaling) e [Fluid Compute](https://vercel.com/docs/fluid-compute), além da configuração do provedor PostgreSQL.

Reserva e checkout permitem 1.500 tentativas por subject em cinco minutos. O status permite 15.000 consultas por subject e 60 por pedido na mesma janela; sincronização manual de pagamento permite 20 por subject em 15 minutos. Esses limites não comprovam capacidade para mais de 500 jornadas completas. Compradores atrás do mesmo IP público compartilham buckets; sem IP confiável, todos os usuários públicos compartilham um bucket fixo, sem uso de `User-Agent` ou idioma como identidade, o que pode causar `429` coletivo. Valide no Preview a configuração do proxy confiável e se os orçamentos evitam bloqueios legítimos sem aumentar abuso; mantenha observabilidade de `429`, reservas por subject, assentos retidos e requisições suspeitas. Não contorne os limites nem falsifique IPs no gerador.

## Diagnóstico de pedido

1. Consulte o pedido e sua reserva pelo `orderId`, confirmando que ambos pertencem ao `contaId` e evento esperados.
2. `PAYMENT_CREATION_IN_PROGRESS` e `PAYMENT_CREATION_UNKNOWN` são inconclusivos: mantenha os assentos reservados até a reconciliação autoritativa. Não marque como falha nem libere manualmente.
3. `PAYMENT_PENDING` com pagamento em aberto permanece aguardando. Pagamento confirmado segue para emissão automática; acompanhe o job de fulfillment e a outbox de e-mail.
4. A expiração só é final quando o job confirmou que a cobrança não está paga/ativa e a transição condicional da reserva foi aplicada. Um pagamento tardio deve convergir pelo webhook/reconciliação; se os assentos já tiverem sido vendidos, siga a rotina de estorno existente e não emita ingresso duplicado.
5. Verifique duplicidade por `orderId`/ticket, tentativas da outbox e estado de check-in antes de qualquer correção operacional. Reprocessos devem continuar idempotentes.

## Reconciliação administrativa restrita

`POST /api/events/{eventId}/public-orders/{orderId}/reconcile-payment` permanece disponível exclusivamente para usuários com `eventFinance.reconcile`, validando a conta da sessão. Use apenas como ferramenta de suporte quando o job automático não convergir e houver investigação documentada. Não oriente organizadores/compradores a dispará-la; a UI da bilheteria não oferece essa ação. Registre o motivo e o resultado no fluxo de auditoria existente.

## Estornos, contestação e check-in

- Estorno de pedido do mapa é integral e só pode ser solicitado se o pagamento estiver confirmado, todos os ingressos estiverem emitidos e nenhum deles tiver check-in. Estorno parcial continua indisponível para pedidos com assentos.
- A solicitação usa comparação e atualização condicionais por `contaId`; pedidos concorrentes não podem iniciar duas solicitações. Se o provedor retornar erro definitivo 4xx, o estado local volta ao anterior. Timeout/erro ambíguo permanece `REFUND_REQUESTED` para impedir uma segunda chamada; suporte deve consultar o Asaas e reconciliar antes de tentar novamente.
- Para Pix/cartão, a solicitação inicia o estorno; só webhook final do Asaas altera o pedido para `REFUNDED` e libera assentos. `PAYMENT_REFUND_IN_PROGRESS` bloqueia check-in, PDF e reenvio de ingressos. `PAYMENT_REFUND_DENIED` restaura a disponibilidade operacional, sem liberar assentos.
- Para boleto, a rota oficial retorna `requestUrl`. O link fica salvo no pedido e uma notificação é colocada na outbox existente para envio ao comprador. O estado continua `REFUND_REQUESTED`; isso não significa que o dinheiro foi devolvido. O comprador precisa concluir a ação bancária, e o webhook final do Asaas confirma o desfecho.
- O `chargeback.status` oficial é persistido sem tradução em `paymentStatus`. `REQUESTED`/`IN_DISPUTE` e os estados de disputa não resolvida são exibidos como `Em disputa`; `REVERSED` libera novamente os ingressos. `DISPUTE_LOST` aparece como `Contestação perdida`, não como estorno voluntário: mantém ingressos bloqueados e exige revisão de suporte, sem liberar assentos. `DONE` aparece como `Contestação encerrada` e também exige reconciliação, pois o valor isolado não informa se a disputa foi ganha ou perdida. Enquanto a disputa estiver aberta/perdida/sem desfecho, check-in, download e e-mail ficam bloqueados.
- O processamento final de estorno cancela apenas ingressos ainda válidos e só libera o assento se o ingresso correspondente não tiver sido usado. Um check-in já registrado nunca é sobrescrito por `CANCELLED`; qualquer combinação assim precisa de reconciliação operacional.

### Matriz de comportamento

| Situação | Estado exibido | Ação do organizador | Efeito nos ingressos/assentos |
| --- | --- | --- | --- |
| Pagamento pendente | `Aguardando` | Ver cobrança | Assentos mantidos até expiração segura; sem ingresso |
| Criação/resultado incerto | `Verificando` | Aguardar reconciliação | Assentos mantidos; sem ingresso |
| Pagamento confirmado, emissão em curso | `Emitindo` | Nenhuma ação manual | Assentos vendidos; emitir automaticamente |
| Confirmado e emitido | `Concluído` | Baixar ou solicitar estorno integral | Check-in permitido; estorno elegível só sem check-in |
| Estorno solicitado/em curso | `Estornando` | Aguardar webhook | Check-in e entrega bloqueados; assentos continuam vendidos |
| Estorno recusado | `Estorno recusado` | Revisar com suporte, se necessário | Ingressos voltam a ficar utilizáveis; assentos continuam vendidos |
| Contestação/chargeback | `Em disputa` | Acompanhar a decisão do provedor | Check-in e entrega bloqueados; assentos continuam vendidos |
| Estorno confirmado | `Estornado` | Nenhuma ação | Ingressos válidos cancelados; assentos liberados uma única vez |
| Reserva vencida sem pagamento | `Expirado` | Nenhuma ação | Assentos liberados apenas após consulta/decisão segura |

### Validação em sandbox antes da promoção

1. Use duas contas de teste e tente ler, reembolsar e checar ingresso da Conta B autenticado como Conta A; todas as operações devem falhar sem alteração cruzada.
2. Tente solicitar estorno duas vezes em paralelo. Apenas uma chamada pode avançar para o provedor; a segunda recebe conflito e nenhum webhook duplicado pode liberar o assento duas vezes.
3. Faça check-in em paralelo com solicitação de estorno. A serialização no pedido deve produzir somente um resultado seguro: check-in ganha e estorno é recusado, ou estorno ganha e check-in é recusado.
4. Simule boleto: a API salva URL segura do Asaas, enfileira a notificação, a tela pública apresenta o link, e o pedido não é exibido como estornado antes do webhook final.
5. Simule cartão/Pix: `PAYMENT_REFUND_IN_PROGRESS` bloqueia ingresso; `PAYMENT_REFUND_DENIED` desbloqueia; `PAYMENT_REFUNDED` cancela ingresso e libera o assento uma vez.
6. Entregue chargeback duplicado e fora de ordem (`PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`) e valide que o estado segue bloqueado. Verifique também `chargeback.status` `DISPUTE_LOST`, `REVERSED` e `DONE`: perda não deve virar `REFUNDED`; só `REVERSED` desbloqueia automaticamente, enquanto perda/estado terminal ambíguo segue para suporte.
7. Simule reserva expirada com assentos disponíveis e indisponíveis. O primeiro caso só emite após reclaim atômico; o segundo não emite e encaminha o estorno automático, inclusive ação de comprador para boleto.

Não promover enquanto o outbox de notificação estiver acumulando, houver solicitação de estorno em resultado desconhecido sem investigação ou os crons da versão ativa não tiverem execução observada.

## Verificação de isolamento e execução

- Compare pedido, reserva, cobrança e assentos sempre com o `contaId` esperado; nunca busque ou atualize por `orderId` isolado em operação manual.
- Antes de aplicar a migration `20261007140000_unique_event_map_order_payment` em qualquer ambiente com dados reais, confirme que nenhum pagamento está vinculado a mais de um pedido na mesma conta. A migration adiciona uma barreira final de unicidade no banco; não remove nem escolhe automaticamente um dos pedidos duplicados.
- Para validar após deploy, confirme configuração dos cinco crons na versão ativa, execuções recentes bem-sucedidas e backlog estável. Faça um cenário de sandbox com Conta A e Conta B e confirme ausência de leitura/alteração cruzada.
- Se Asaas estiver indisponível ou retornar resultado ambíguo, preserve o hold, registre o erro operacional e aguarde retry/reconciliação. Não resolva por exclusão direta no banco.

Preflight somente leitura antes da migration de unicidade:

```sql
SELECT "contaId", "asaasPaymentId", array_agg(id ORDER BY "createdAt") AS "orderIds", count(*) AS pedidos
FROM "EventMapOrder"
WHERE "asaasPaymentId" IS NOT NULL
GROUP BY "contaId", "asaasPaymentId"
HAVING count(*) > 1;
```

O resultado esperado é vazio. Se houver linhas, investigue cada pedido e seu histórico de webhook/reconciliação antes da migration; não remova vínculos automaticamente.

Consultas somente leitura para investigação no banco (substitua `:conta_id` pelo tenant autorizado e mantenha o filtro):

```sql
-- Volume de pedidos pendentes por estado do provedor e idade do mais antigo.
SELECT "paymentStatus", count(*) AS pedidos, min("updatedAt") AS mais_antigo
FROM "EventMapOrder"
WHERE "contaId" = :conta_id AND status = 'PAYMENT_PENDING'
GROUP BY "paymentStatus"
ORDER BY pedidos DESC;

-- Reservas vencidas que ainda estão retidas; esperado somente durante verificação,
-- pagamento ativo ou backlog de expiração.
SELECT r.id, r."eventId", r."expiresAt", o.id AS "orderId",
       o.status AS "orderStatus", o."paymentStatus", o."asaasPaymentId"
FROM "EventMapReservation" r
LEFT JOIN "EventMapOrder" o
  ON o."reservationId" = r.id AND o."contaId" = r."contaId"
WHERE r."contaId" = :conta_id
  AND r.status = 'HELD'
  AND r."expiresAt" < now()
ORDER BY r."expiresAt" ASC
LIMIT 200;

-- Pedidos confirmados aguardando emissão ou com falha operacional.
SELECT id, "eventId", status, "ticketFulfillmentStatus",
       "ticketFulfillmentAttempts", "ticketFulfillmentLastAttemptAt",
       "ticketFulfillmentLastError", "updatedAt"
FROM "EventMapOrder"
WHERE "contaId" = :conta_id
  AND status = 'CONFIRMED'
  AND "ticketFulfillmentStatus" <> 'ISSUED'
ORDER BY "updatedAt" ASC
LIMIT 200;
```

Para provar execução do cron, use os logs da versão/deployment ativo e correlacione horário, resultado e métricas acima; as consultas mostram backlog atual, não histórico de execução nem prova de que o job rodou.
