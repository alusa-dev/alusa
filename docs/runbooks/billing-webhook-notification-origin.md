# BILLING_WEBHOOK para origens de pagamento

## Mudança

O efeito de notificação reconhece `EventMapOrder` e `EventTicketSale` dentro do `contaId`. Vendas de ingresso são concluídas como não aplicáveis à inbox financeira. Vínculos múltiplos ou conflitantes terminam com erro diagnosticável; uma entidade ainda ausente mantém o retry existente. A confirmação financeira e a emissão dos ingressos continuam no fluxo de eventos.

O saneamento P0 é estritamente limitado a linhas históricas `FAILED` de `BILLING_WEBHOOK` que tenham o erro exato de entidade esgotada e IDs de tenant e recurso correspondentes. Somente essas linhas são marcadas `DONE` na mesma transação que sua classificação manual `EXTERNAL`, com entradas de auditoria. Notificações antigas não são reenviadas. Linhas ambíguas, conflitantes ou vinculadas a proprietários locais permanecem inalteradas para investigação.

## Validação antes e depois da publicação

No Preview, execute o cenário Playwright existente com banco de teste isolado e provider mock. O cenário focado `BILLING_WEBHOOK` cobre publicação, reserva de dois lugares, checkout sintético, três entregas do webhook, confirmação e emissão de dois ingressos, processamento real da outbox, ausência de inbox/notificação de cobrança e tentativa de spoof entre contas. Confirme uma única venda e um único efeito `BILLING_NOTIFICATION`. Após a publicação, acompanhe `inbox.skipped.event_ticket_payment`, `inbox.failed.origin_inconsistent` e `inbox.pending.failed`; classifique os erros persistentes por origem e `contaId` antes de qualquer ação operacional.

O lifecycle externo do Sandbox Asaas está em `apps/web/e2e/asaas.integration.spec.ts` e usa diretamente o SDK `@alusa/asaas` para criar customer e boleto, verificá-los por lookup/listagem e removê-los em `finally`. É opt-in via `E2E_ASAAS_SANDBOX=true`; falha fechado se o host de `ASAAS_BASE_URL` não for exatamente `api-sandbox.asaas.com` ou se `DATABASE_URL_TEST` não apontar exatamente para `alusa_test`. Execute apenas de forma deliberada, com credencial Sandbox; o teste faz chamadas externas e não integra o fluxo mock do Preview.

Comando focado validado localmente:

```sh
FIN_WEBHOOK_ASYNC_ENABLED=true NEXT_DIST_DIR=.next-playwright pnpm --filter @alusa/web exec playwright test e2e/event-map-publication-sales.spec.ts --grep "BILLING_WEBHOOK" --retries=0
```

O cenário Playwright amplo de publicação/venda valida a proteção de republicação com reserva ativa (`MAPA_COM_RESERVAS_ATIVAS`), libera a reserva sintética no banco de teste e então confirma a nova versão do mapa. Os requests de PATCH e publicação enviam `expectedUpdatedAt`, obrigatório pelos schemas atuais. O cenário focado intercepta o endpoint de verificação KYC e usa os adapters Playwright; ele não chama o Asaas. Uma tentativa anterior antes de instalar essa interceptação usou somente a chave sintética de teste e recebeu 401 em GET de verificação; não houve escrita externa.

## Registros históricos e rollback

Somente o conjunto P0 qualificado descrito acima pode ser classificado pelo procedimento operacional correspondente, com matching exato de tenant/recurso e auditoria transacional. Os registros ambíguos, conflitantes e com proprietário local devem ser investigados sem mudança de estado. Não reenvie notificações antigas, recrie cobrança/pagamento/ingresso ou marque lotes indiscriminadamente. Nenhuma classificação de produção ou alteração de dados foi executada como parte desta mudança.

Se houver regressão, reverta a aplicação pelo fluxo normal de release. Não limpe nem reinicie a fila durante rollback; preserve tentativas, dedupe keys e histórico para diagnóstico. Nenhum acesso ou saneamento de produção faz parte desta alteração.
