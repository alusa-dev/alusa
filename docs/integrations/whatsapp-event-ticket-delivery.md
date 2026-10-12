# Entrega de ingressos por WhatsApp

## Fluxo

1. No checkout público, o comprador informa o mesmo telefone usado para as comunicações da compra e vê o aviso de consentimento antes de concluir.
2. Na venda manual, a secretaria informa o telefone somente após confirmar verbalmente a autorização do comprador. A venda pode continuar sem telefone.
3. Depois que o pagamento é confirmado e todos os ingressos são emitidos, a mesma transação grava uma notificação durável em `EventTicketWhatsAppNotification`. Nenhuma chamada à Meta ocorre dentro da transação financeira.
4. O cron `/api/jobs/whatsapp` executa a cada cinco minutos. Ele processa notificações de ingresso, cria um job idempotente na outbox geral do WhatsApp, envia os jobs pendentes e atualiza o estado com os webhooks da Meta.
5. O botão do template abre um PDF com todos os ingressos daquela compra. O link contém um token opaco, aceita somente pedidos confirmados/vendas pagas e não expõe o ID interno da compra. Respostas `SAIR`, `PARAR`, `STOP`, `CANCELAR` ou `REMOVER` ao número oficial revogam o consentimento e cancelam notificações ainda pendentes.

Falhas recuperáveis usam backoff exponencial de 15 segundos até uma hora, com até oito tentativas. Falhas permanentes e tentativas esgotadas ficam em DLQ; os campos de correlação e erro permitem investigar. A chave idempotente impede mensagens duplicadas na criação inicial. Reenvios solicitados pela equipe recebem uma chave própria, são auditados e limitados a três em quinze minutos por compra.

## Template Meta

Cadastre e aprove no WhatsApp Manager:

- **Nome:** `ingresso_emitido`
- **Categoria:** Utilidade
- **Idioma:** Português (Brasil), código `pt_BR`
- **Cabeçalho:** `Ingresso confirmado` (texto estático, opcional)
- **Corpo:** `Olá, {{1}}! O pagamento da sua compra para {{2}} foi confirmado. Seu ingresso digital está disponível no botão abaixo. Apresente-o na entrada do evento.`
- **Amostras:** `{{1}}` = `Ana Silva`; `{{2}}` = `6º Festival de Dança`
- **Botão:** URL / visitar site, rótulo `Acessar ingresso`
- **URL dinâmica:** prefixo estático `https://alusa.app/api/public/event-ticket-links/` seguido por uma única variável dinâmica `{{1}}` no final.

O nome, idioma, ordem das variáveis e prefixo da URL precisam coincidir exatamente com a configuração da Alusa e com o template aprovado. O botão deve usar variável de URL no último segmento; não inclua o token de exemplo como parte do prefixo fixo.

## Configuração de produção

Configure no ambiente de produção da aplicação:

```env
WHATSAPP_ENABLED=true
WHATSAPP_EVENT_TICKET_TEMPLATE_NAME=ingresso_emitido
WHATSAPP_EVENT_TICKET_TEMPLATE_LANGUAGE=pt_BR
APP_URL=https://alusa.app
WHATSAPP_EVENT_TICKET_URL_PREFIX=https://alusa.app/api/public/event-ticket-links/
```

`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` e `WHATSAPP_WABA_ID` também precisam estar configurados conforme a integração oficial já existente. Não coloque segredos no repositório. O prefixo do botão é validado contra `APP_URL`; URLs divergentes ou sem HTTPS impedem o envio e direcionam a notificação para tratamento de falha.

## Acompanhamento e reenvio

O painel de vendas e o painel de pedidos públicos exibem **Reenviar ingresso pelo WhatsApp** quando há uma compra paga/confirmada, ingressos emitidos e autorização registrada. A ação apenas grava uma nova notificação e retorna sem chamar a Meta na requisição. A fila existente realiza o envio no próximo ciclo do cron.

Após implantar, acompanhe `eventTicketNotifications`, `outbox` e `webhooks` na resposta/log do job `whatsapp`. Para entrega final, use os estados reportados pela Meta: enviado, entregue, lido ou falhou. Reenvios não são permitidos após a revogação de consentimento.

Pedidos anteriores à implantação não têm evidência de consentimento salva pela Alusa e não entram no envio automático. A equipe deve obter autorização e registrar o telefone por um fluxo autorizado antes de qualquer envio manual posterior.
