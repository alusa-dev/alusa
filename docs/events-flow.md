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

## Mapa e Checkout Público

O checkout público do mapa usa reserva temporária, valida assentos e cria cobrança Asaas com chave de idempotência por pedido.

Se a criação de cobrança falha, o fluxo tenta reconciliar por `externalReference` antes de cancelar o pedido local. A confirmação financeira deve continuar vindo por webhook.

## Pendências

- Mover reconciliação de pedido público para `packages/finance` quando a fronteira Eventos/Financeiro estiver pronta.
- Criar E2E Playwright cobrindo evento, mapa, checkout público, webhook simulado e relatórios.
- Criar jobs automáticos de expiração e reconciliação operacional.
- Fortalecer observabilidade para divergências: pedido pago sem ticket, pedido confirmado com assento não vendido e pedido pendente sem cobrança.
