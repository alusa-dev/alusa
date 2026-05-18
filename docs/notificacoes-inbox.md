# Inbox Interna de Notificações

## Objetivo

A inbox interna é o canal operacional da equipe administrativa para acompanhar eventos de matrícula e financeiros dentro da Alusa. Ela é separada de:

- preferências de notificações do usuário
- notificações Asaas por tenant/customer
- notificações do portal do aluno/responsável

## Fluxo ponta a ponta

1. Um produtor interno dispara um evento de negócio.
2. O serviço central `packages/lib/src/services/notifications.service.ts` resolve destinatários, deduplica por `dedupeKey` e persiste `Notification` + `NotificationRecipient`.
3. As rotas `/api/notifications` e `/api/notifications/[id]` expõem listagem e mutações por recipient autenticado.
4. O header consome o feed resumido e a página `/notificacoes` consome a inbox completa.

## Produtores atuais

Ver catálogo completo: [notificacoes-catalogo.md](./notificacoes-catalogo.md).

- Matrícula, rematrícula, pausa, retomada, cancelamento.
- Financeiro: fila de webhooks (`processAsaasWebhookQueueWithInbox`), **todo** `syncPaymentStateFromAsaas`, cron de atrasados.
- Contratos: assinatura, cancelamento, expiração, alertas 7/3/1 dias.
- Aulas experimentais: agendar, reagendar, realizar, cancelar.

## Regras principais

- Destinatários padrão: `ADMIN`, `FINANCEIRO`, `RECEPCAO`.
- Deduplicação: `(contaId, dedupeKey)`.
- Exclusão remove o vínculo do recipient; a entidade `Notification` só é removida quando não restam destinatários.
- Eventos financeiros suportados na inbox:
  - `PAYMENT_CREATED`
  - `PAYMENT_OVERDUE`
  - `PAYMENT_CONFIRMED`
  - `PAYMENT_RECEIVED`
  - `PAYMENT_RECEIVED_IN_CASH`
  - `DUNNING_RECEIVED`

## Observabilidade

- Falhas de criação da inbox são tratadas como não críticas para o fluxo financeiro principal.
- O sistema registra contexto de deduplicação, ausência de destinatários e falta de entidade local reconciliada.
