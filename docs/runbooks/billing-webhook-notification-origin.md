# BILLING_WEBHOOK para origens de pagamento

## Mudança

O efeito de notificação reconhece `EventMapOrder` e `EventTicketSale` dentro do `contaId`. Vendas de ingresso são concluídas como não aplicáveis à inbox financeira. Vínculos múltiplos ou conflitantes terminam com erro diagnosticável; uma entidade ainda ausente mantém o retry existente. A confirmação financeira e a emissão dos ingressos continuam no fluxo de eventos.

## Validação antes e depois da publicação

No Preview, execute o cenário Playwright existente com banco de teste isolado e provider mock. O cenário focado `BILLING_WEBHOOK` cobre publicação, reserva de dois lugares, checkout sintético, três entregas do webhook, confirmação e emissão de dois ingressos, processamento real da outbox, ausência de inbox/notificação de cobrança e tentativa de spoof entre contas. Confirme uma única venda e um único efeito `BILLING_NOTIFICATION`. Após a publicação, acompanhe `inbox.skipped.event_ticket_payment`, `inbox.failed.origin_inconsistent` e `inbox.pending.failed`; classifique os erros persistentes por origem e `contaId` antes de qualquer ação operacional.

Comando focado validado localmente:

```sh
FIN_WEBHOOK_ASYNC_ENABLED=true NEXT_DIST_DIR=.next-playwright pnpm --filter @alusa/web exec playwright test e2e/event-map-publication-sales.spec.ts --grep "BILLING_WEBHOOK" --retries=0
```

O cenário Playwright amplo de publicação/venda valida a proteção de republicação com reserva ativa (`MAPA_COM_RESERVAS_ATIVAS`), libera a reserva sintética no banco de teste e então confirma a nova versão do mapa. Os requests de PATCH e publicação enviam `expectedUpdatedAt`, obrigatório pelos schemas atuais. O cenário focado intercepta o endpoint de verificação KYC e usa os adapters Playwright; ele não chama o Asaas. Uma tentativa anterior antes de instalar essa interceptação usou somente a chave sintética de teste e recebeu 401 em GET de verificação; não houve escrita externa.

## Registros históricos e rollback

Registros `FAILED` preexistentes não são alterados nem reprocessados por esta mudança. Para saneamento, classifique-os em leitura por conta e payment ID contra as entidades locais; mantenha os casos sem vínculo ou ambíguos para revisão. Reprocesse somente efeitos de notificação comprovadamente pendentes por procedimento já existente, após confirmar idempotência. Não recrie cobrança, pagamento ou ingresso e não marque lotes como concluídos.

Se houver regressão, reverta a aplicação pelo fluxo normal de release. Não limpe nem reinicie a fila durante rollback; preserve tentativas, dedupe keys e histórico para diagnóstico. Nenhum acesso ou saneamento de produção faz parte desta alteração.
