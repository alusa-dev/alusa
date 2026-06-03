# Fluxo de Eventos

Este documento registra as regras operacionais atuais do módulo de Eventos da Alusa.

## Participantes

Uma inscrição de participante deve existir uma única vez para o mesmo aluno no mesmo evento.

Estados práticos:

- Ativa: participante inscrito e operável no evento.
- Cancelada: inscrição encerrada com histórico preservado.
- Removível: inscrição cancelada sem histórico financeiro ou operacional relevante.
- Reinscrita: a mesma inscrição cancelada é reativada, sem criar novo `EventParticipant`.

Diferenças de ação:

- Cancelar inscrição preserva o participante e o histórico, cancela cobranças abertas quando aplicável e registra auditoria `events.participant.unregister`.
- Remover aluno do evento só é permitido para inscrição cancelada sem histórico sensível. A ação remove apenas o vínculo vazio e registra auditoria `events.participant.remove`.
- Reinscrever aluno reativa a mesma inscrição, limpa o estado de cancelamento e cria nova cobrança ou novo lançamento financeiro quando houver taxa. Cobranças antigas canceladas não são reaproveitadas.

Bloqueios de remoção/reinscrição automática:

- pagamento total ou parcial;
- estorno;
- lançamento financeiro realizado;
- cobrança Asaas aberta, paga ou estornada;
- ingresso, ticket ou pedido público;
- figurino vinculado, entregue, devolvido, danificado, perdido ou pago;
- qualquer histórico operacional relevante.

## Fonte da Verdade Financeira

Webhooks Asaas são a fonte principal de mudança de estado financeiro.

Telas e rotas `GET` devem ler o estado local/read model. Elas não devem consultar Asaas nem atualizar banco apenas por visualização.

Chamadas diretas ao Asaas ficam restritas a:

- criação/cancelamento explícito de cobrança;
- preflight operacional;
- documentos oficiais, como QR Code Pix ou carnê;
- reconciliação explícita;
- correção administrativa de divergência.

## Reconciliação Explícita

Pedidos públicos do mapa podem ser reconciliados por ação administrativa:

`POST /api/events/[eventId]/public-orders/[orderId]/reconcile-payment`

A ação:

- exige permissão financeira de reconciliação;
- busca o pedido por `contaId`, `eventId` e `orderId`;
- não chama Asaas se o pedido não tem `asaasPaymentId`;
- não chama Asaas se `paymentMethod` já está preenchido;
- consulta Asaas quando existe `asaasPaymentId` e falta `paymentMethod`;
- atualiza apenas a divergência local necessária;
- registra auditoria `events.publicOrder.payment.reconcile`;
- é idempotente.

O use case canônico fica em `packages/finance/src/events/reconcile-event-map-order-payment.ts`.
As rotas de Eventos apenas autenticam/autorizam a ação e delegam para a camada financeira.

## Mapa e Checkout Público

O checkout público do mapa usa reserva temporária, valida assentos e cria cobrança Asaas com chave de idempotência por pedido.

Se a criação de cobrança falha, o fluxo tenta reconciliar por `externalReference` antes de cancelar o pedido local. A confirmação financeira deve continuar vindo por webhook.

## Endurecimento de Produção

### Jobs

Os jobs operacionais de Eventos ficam em `packages/finance/src/events/event-map-order-jobs.ts` e são expostos por rotas protegidas por segredo de cron:

- `GET|POST /api/jobs/events-expire-reservations`
- `GET|POST /api/jobs/events-reconcile-orders`
- `GET|POST /api/jobs/events-inspect-financial-inconsistencies`

Parâmetros comuns:

- `contaId`: execução dirigida para uma conta; se omitido, processa contas com atividade de mapa até `maxAccounts`.
- `limit`: limite de registros por conta.
- `maxAccounts`: limite de contas por execução multi-tenant.

Execução manual:

```bash
curl -X POST "$APP_URL/api/jobs/events-expire-reservations?contaId=..." \
  -H "x-cron-token: $CRON_SECRET"
```

Env vars:

- `CRON_SECRET` ou `CRON_SECRET_TOKEN`: segredo aceito pelo middleware e por `resolveTenantScope`.
- Credenciais Asaas da conta: necessárias apenas para reconciliações que consultam o Asaas.

Regras:

- Jobs são idempotentes e usam lock operacional.
- Expiração libera apenas reservas vencidas sem cobrança Asaas vinculada e sem histórico operacional.
- Reservas vencidas com `asaasPaymentId` não são liberadas cegamente; entram em reconciliação/inspeção.
- Reconciliação automática preenche dados auxiliares seguros, como `paymentMethod`; não substitui webhook como fonte de pagamento.
- Inspeção financeira gera relatório/logs e não corrige estado automaticamente.

### Observabilidade

Logs estruturados usam o prefixo `[events.finance]` e payloads mínimos:

- criação/preparação de pedido público;
- criação de cobrança Asaas do checkout público;
- reconciliação explícita e por job;
- expiração de reserva;
- inconsistências financeiras detectadas.

Não devem ser logados API keys, documentos completos, tokens, payload bruto do Asaas ou dados pessoais desnecessários.

### E2E

Cobertura Playwright adicionada:

- proteção dos jobs por segredo;
- expiração idempotente de reserva pública vencida sem cobrança externa;
- inspeção de pedido confirmado sem ticket e com assento divergente;
- garantia de que a inspeção não altera estado financeiro do pedido.

O E2E existente de mapa público continua cobrindo publicação, compra pública mockada, emissão de PDF e preservação de versão pública.

## Pendências

- Completar E2E Playwright full-story do fluxo de participante: criar/editar evento, inscrever, cancelar, reinscrever, remover e bloquear remoção por histórico.
- Criar E2E com webhook Asaas simulado para confirmação real de pedido público e emissão de ticket.
- Avaliar remoção futura da expiração inline chamada por ações POST de reserva/checkout, mantendo apenas job explícito se a UX permitir.
- Migrar gradualmente outros comandos financeiros de Eventos para `packages/finance` quando não houver risco de acoplamento circular.
- Evoluir inspeção financeira para alerta operacional persistido, se necessário.
