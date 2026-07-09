# Checklist futuro de producao - Stripe Platform Billing

Este checklist e para quando a Alusa decidir ativar cobrancas reais com Stripe Billing.

Status atual: nao executar agora. A implementacao deve permanecer em homologacao/test mode ate decisao explicita de rollout.

## Regra de seguranca

- Nao trocar `STRIPE_ENVIRONMENT` para `LIVE` sem aprovacao de produto, financeiro e engenharia.
- Nao cadastrar `STRIPE_LIVE_SECRET_KEY` em ambiente usado por clientes reais sem checklist completo.
- Nao apontar webhooks live para producao sem validacao de assinatura, idempotencia e replay.
- Nao migrar contas reais para cobranca automatica sem comunicacao operacional.
- Nao confiar apenas no Dashboard Stripe; a Alusa deve continuar lendo estado local reconciliado.

## Stripe Dashboard

- Criar Products e Prices live para `STARTER`, `PREMIUM` e `PRO`.
- Conferir que os valores live batem com a politica comercial vigente.
- Configurar Customer Portal live para alterar cartao, ver faturas, baixar recibos e atualizar dados de cobranca.
- Ativar Smart Retries em Billing > Revenue recovery > Retries.
- Definir politica de dunning antes do rollout. Recomendacao inicial: ate 8 tentativas em 14 dias, com 7 dias de carencia controlados pela Alusa.
- Definir comportamento final apos retries esgotados: restringir acesso na Alusa e, quando aplicavel, cancelar ou marcar a assinatura conforme politica comercial.
- Conferir e-mails nativos da Stripe apenas como apoio. A tela principal para a escola continua sendo a Alusa.

## Variaveis de ambiente

- `STRIPE_ENVIRONMENT=LIVE`
- `STRIPE_SECRET_KEY` com chave live correta.
- `STRIPE_WEBHOOK_SECRET` do endpoint live.
- Price IDs live dos planos comerciais.
- `PLATFORM_BILLING_WORKER_SECRET` configurado para rotinas internas.
- Configuracao de e-mail transacional validada, se notificacoes estiverem ativas.

## Webhooks

Endpoint da Alusa: `/api/webhooks/stripe`.

Eventos obrigatorios:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`
- `customer.subscription.trial_will_end`
- `invoice.created`
- `invoice.finalized`
- `invoice.updated`
- `invoice.paid`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `invoice.marked_uncollectible`
- `invoice.voided`

Conferir antes de liberar:

- Assinatura do webhook validada com payload bruto.
- Idempotencia por `event.id`.
- Inbox de webhooks com retry e estado `EXHAUSTED`.
- Replay administrativo funcionando.
- Logs sem expor segredo, cartao ou payload sensivel.

## Rotinas da Alusa

Executar `/api/admin/platform-billing/maintenance` com `PLATFORM_BILLING_WORKER_SECRET`.

O job deve:

- Drenar webhooks pendentes.
- Aplicar trocas de plano pendentes.
- Encerrar periodo de carencia vencido.
- Reconciliar Alusa x Stripe.

Cadencia sugerida:

- Webhooks pendentes: a cada 1 minuto.
- Manutencao completa: a cada 15 minutos.
- Reconciliacao completa: pelo menos 1 vez ao dia.

## Estados de acesso

- `ACTIVE`: acesso normal.
- `TRIALING`: acesso normal enquanto o teste estiver ativo.
- `PAST_DUE` + `GRACE_PERIOD`: pagamento pendente, com carencia.
- `UNPAID` ou `PAUSED` + `RESTRICTED`: acesso restrito; suporte e pagamento seguem liberados.
- `CANCELED`: acesso encerrado; reativacao inicia novo checkout quando a Stripe nao permite desfazer o cancelamento.

## Cenarios obrigatorios com Test Clocks

- Trial com cartao cadastrado.
- Trial sem cartao cadastrado.
- Evento `customer.subscription.trial_will_end`.
- Cobranca pos-trial paga.
- Cobranca pos-trial falha.
- Cartao recusado.
- Cartao expirado.
- Cartao com autenticacao exigida.
- Smart Retry e proxima tentativa.
- Recuperacao apos pagamento.
- Cancelamento no fim do ciclo.
- Reversao de cancelamento ainda no ciclo.
- Reativacao depois de assinatura cancelada.
- Troca de plano em trial.
- Troca de plano fora do trial.
- Plano incompativel por limite de alunos ativos.

## Auditoria

Conferir logs para:

- Cadastro depois no onboarding.
- Checkout criado.
- Trial iniciado.
- Trial proximo do fim.
- Troca de plano.
- Cancelamento.
- Reversao de cancelamento.
- Reativacao.
- Alteracao de pagamento.
- Falha de pagamento.
- Pagamento recuperado.
- Reconciliacao com correcao automatica.
- Issue de reconciliacao que exige acao manual.

## Criterio de liberacao

So liberar producao quando:

- Todos os cenarios de Test Clock estiverem validados.
- Webhook live estiver recebendo e processando eventos reais de teste controlado.
- Customer Portal live estiver configurado.
- Smart Retries estiver definido e documentado.
- Regras de capacidade estiverem preservadas.
- Suporte souber ler estado da assinatura na Alusa.
- Produto aprovar textos, callouts e fluxos de bloqueio.
- Financeiro aprovar politica de carencia, retries e cancelamento.
- Engenharia aprovar rollback e reconciliacao.
