# Stripe Platform Billing - homologacao

Este documento registra o estado atual da implementacao de assinaturas da Alusa com Stripe Billing.

Status: implementacao pronta para homologacao, mas producao nao sera ativada agora.

## Escopo

A Stripe e usada para cobrar a assinatura comercial da Alusa junto as escolas e contas da plataforma.

A Asaas continua separada e responsavel pelo financeiro educacional das escolas: mensalidades, cobrancas de alunos e responsaveis, Pix, boleto, subcontas, KYC, webhooks e reconciliacao escolar.

## O que ja fica coberto

- Onboarding financeiro com cadastro de cartao.
- Onboarding financeiro com `Cadastrar depois`, iniciando trial sem cartao.
- Trial com contagem correta na Alusa.
- Avisos visuais de trial ativo e fim do trial.
- Cadastro de cartao durante o trial.
- Troca de plano durante o trial.
- Troca de plano fora do trial.
- Regras de capacidade antes da troca ou reativacao de plano.
- Cancelamento de assinatura.
- Reversao de cancelamento quando ainda ha periodo vigente.
- Reativacao depois de assinatura cancelada, usando novo checkout quando necessario.
- Customer Portal para alterar forma de pagamento e acessar faturas.
- Historico financeiro com estados como pago, gratis, aberto, falhou, cancelado e estornado quando os dados estiverem disponiveis.
- Falha de pagamento pos-trial.
- Estado de carencia antes de restringir acesso.
- Restricao de acesso quando a pendencia nao for resolvida.
- Webhooks idempotentes da Stripe.
- Reconciliacao Alusa x Stripe.
- Auditoria de acoes criticas.
- Notificacoes internas e transacionais para eventos principais.

## Comportamento no dia a dia

### Escola inicia trial com cartao

A escola escolhe o plano, cadastra o cartao na Stripe e volta para a Alusa. A assinatura fica em trial. A cobranca so comeca no fim do teste, se nao houver cancelamento antes.

### Escola inicia trial sem cartao

A escola escolhe `Cadastrar depois`. A Alusa cria o estado comercial da conta, inicia o trial e permite continuar o onboarding. O usuario pode voltar depois e cadastrar o cartao.

### Trial perto do fim

A Alusa pode exibir callout e notificacao amigavel. Se nao houver cartao, a acao principal deve levar para atualizar pagamento. A mensagem deve evitar repeticao em varias areas da tela.

### Cobranca pos-trial paga

Quando a Stripe confirma pagamento por webhook, a Alusa mantem ou volta o acesso para normal, atualiza fatura e limpa alertas de recuperacao.

### Cobranca falha

Quando a cobranca falha, a Alusa registra a fatura, mostra estado de pagamento pendente e coloca a conta em carencia quando aplicavel. A acao principal deve ser atualizar pagamento.

### Pagamento exige autenticacao

Quando a Stripe indicar autenticacao ou acao do cliente, a Alusa deve tratar como recuperacao de pagamento. O usuario deve ser levado para o fluxo oficial da Stripe.

### Carencia vencida

Se o prazo de tolerancia acabar sem pagamento, a Alusa restringe o acesso conforme politica de negocio. A tela de cobranca, suporte e atualizacao de pagamento devem continuar acessiveis.

### Cancelamento

Se a assinatura estiver marcada para cancelar no fim do ciclo, a Alusa mostra acesso mantido ate a data final e permite reverter cancelamento quando a Stripe ainda permite.

Se a assinatura ja estiver encerrada, a acao correta e reativar, abrindo escolha de plano e checkout coerente.

### Reativacao

Assinatura ja cancelada nao deve ser tratada como simples reversao. A Alusa abre o fluxo de escolha de plano e cria novo checkout. O estado local so deve ser confirmado apos retorno/webhook da Stripe.

### Troca de plano

Troca de plano respeita limite de alunos ativos:

- Se o plano suporta a quantidade atual de alunos, a acao fica disponivel.
- Se o plano nao suporta, o card deve indicar plano incompativel.
- Downgrade nao deve ser permitido enquanto houver alunos ativos acima do limite.

## Estados principais

- `TRIALING`: teste gratis ativo.
- `ACTIVE`: assinatura ativa e acesso normal.
- `PAST_DUE`: pagamento pendente.
- `GRACE_PERIOD`: acesso temporariamente mantido durante recuperacao de pagamento.
- `RESTRICTED`: acesso limitado por pendencia financeira.
- `CANCELED`: assinatura encerrada.

## Webhooks cobertos

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

A regra operacional e: a UI pode iniciar fluxos, mas o estado financeiro definitivo deve vir de webhook, reconciliacao ou leitura segura da Stripe no servidor.

## Dunning e recuperacao

A Stripe deve cuidar das novas tentativas automaticas por Smart Retries quando isso for ativado no Dashboard.

A Alusa deve refletir esse estado para o usuario:

- pagamento pendente;
- proxima tentativa, quando disponivel;
- atualizacao de cartao;
- carencia;
- restricao se nao houver recuperacao.

Politica recomendada para producao futura: ate 8 tentativas em 14 dias na Stripe, com 7 dias de carencia operacional na Alusa. Essa politica ainda precisa ser aprovada antes de producao.

## Reconciliacao

A rotina administrativa compara estado local da Alusa com a Stripe e corrige divergencias seguras. Divergencias ambiguas viram issues operacionais para analise manual.

Endpoint interno:

- `/api/admin/platform-billing/maintenance`

Protecao:

- `PLATFORM_BILLING_WORKER_SECRET`

Responsabilidades:

- drenar webhooks pendentes;
- aplicar mudancas pendentes de plano;
- expirar carencia;
- reconciliar assinatura, plano, faturas e estado de acesso.

## UI e UX

O padrao visual deve continuar minimalista:

- Callouts no topo para estados relevantes.
- Evitar informacao duplicada dentro das secoes.
- Botao principal levando para a proxima acao util.
- Modais apenas quando a decisao exige contexto.
- Customer Portal aberto como fluxo externo seguro.
- Botao de saude da assinatura oculto para usuario final.

Textos devem ser claros para a escola e evitar termos tecnicos como webhook, dunning, retry ou subscription.

## Auditoria

Devem ficar auditaveis:

- inicio do trial;
- cadastro depois;
- criacao de checkout;
- checkout concluido;
- troca de plano;
- cancelamento;
- reversao;
- reativacao;
- alteracao de pagamento;
- falha de pagamento;
- pagamento recuperado;
- reconciliacao automatica;
- divergencia que exige acao manual.

## Validacoes ja realizadas

- Prisma generate executado.
- Migration local aplicada.
- Testes do pacote `platform-billing` passaram.
- Build/typecheck de `platform-billing` passou.
- Typecheck de `apps/web` passou.
- Fluxos manuais principais foram validados em test mode.

## O que nao fazer agora

- Nao ativar Stripe live.
- Nao configurar cobranca real para clientes.
- Nao ligar webhook live.
- Nao trocar Price IDs test por live.
- Nao iniciar rollout financeiro em producao.
- Nao comunicar cobranca automatica como ativa.

## Para retomar producao depois

Usar o checklist em `docs/platform-billing-stripe-production-checklist.md`.

Tambem revisar a documentacao oficial da Stripe antes do rollout:

- Smart Retries: https://docs.stripe.com/billing/revenue-recovery/smart-retries
- Test Clocks: https://docs.stripe.com/billing/testing/test-clocks
- Customer Portal: https://docs.stripe.com/customer-management/integrate-customer-portal
- Subscription webhooks: https://docs.stripe.com/billing/subscriptions/webhooks
